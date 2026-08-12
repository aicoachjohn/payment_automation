// @vitest-environment node
/**
 * Phase 5 verification — the five checks from the build pack:
 *   1. A Combo Premium Double Shot lead WITH a concession → the draft contains every
 *      one of the 13 FR-SAL-32 elements, correct.
 *   2. Change the template in SystemConfig and regenerate → the change appears with no
 *      code change and no restart.
 *   3. Generation with a missing pincode → the error names the pincode.
 *   4. Regenerate → both versions are retained and viewable.
 *   5. (Speed) the draft is produced by ONE service call — timed here.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, ConcessionThresholdType } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { createLead, markInterested, selectCourse, updateBasicDetails, requestConcession } =
  await import("@/server/services/leads");
const { generateDraft, listDraftVersions, setDraftConfig, getDraftConfig, draftGenerationBlockers, getDraftVersion } =
  await import("@/server/services/draft");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let admin: { userId: string; role: Role };
const TAG = "phase5-verify";

const DETAILS = {
  fullName: "Suresh Kumar Krishnasamy", dob: "1984-01-08", doorNo: "56A/6", street: "S.Thiruvenkitapuram",
  address: "Rajapalayam Tk", district: "Virudhunagar", state: "Tamil Nadu", pincode: "626136",
  email: "suresh.p5v@example.com", mobile: "9845012345",
};

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const eids = leads.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (eids.length) await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: eids } } });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  admin = { userId: (await prisma.user.findFirstOrThrow({ where: { role: Role.SUPER_ADMIN } })).id, role: Role.SUPER_ADMIN };
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function readyLead(withConcession: boolean, tagEmail: string, mobile: string) {
  const { id } = await createLead(mathiew, { fullName: DETAILS.fullName, leadSource: TAG });
  await markInterested(mathiew, id);
  await updateBasicDetails(mathiew, id, { ...DETAILS, email: tagEmail, mobile });
  await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT", commencingDate: new Date("2026-09-01").toISOString() });
  if (withConcession) {
    // ₹2,000 on a ₹89,999 standard fee is at/below min(₹2000, 10%) → AUTO_APPROVED.
    await requestConcession(mathiew, id, { concessionType: ConcessionThresholdType.AMOUNT, concessionValue: "2000", reason: "Loyalty discount" });
  }
  return id;
}

describe("#1 — Combo Premium Double Shot + concession draft has all 13 FR-SAL-32 elements", () => {
  it("prints the draft and asserts each element", async () => {
    const id = await readyLead(true, "suresh.c1@example.com", "9845010001");
    const draft = await generateDraft(mathiew, id);
    console.log("\n──────── GENERATED DRAFT ────────\n" + draft.content + "\n─────────────────────────────────");
    const c = draft.content;
    const el: [string, RegExp][] = [
      ["1 confirmation type", /\*Enrollment Confirmation - PREMIUM\*/],
      ["2 full name", /Full Name : Suresh Kumar Krishnasamy/],
      ["3 DOB", /DOB : 08-Jan-1984/],
      ["4 full address + pincode", /Pincode : 626136/],
      ["5 email", /Email ID : suresh\.c1@example\.com/],
      ["6 mobile", /Mobile No : 9845010001/],
      ["7 program name", /Advanced Data Analytics \+ Advanced Data Science and AI \+ Gen AI & Agentic AI/],
      ["8 plan (+ combo)", /Double Shot "PREMIUM"/],
      ["9 course/approved fee + concession", /Course Fee : \*INR\.87,999\/-\*/],
      ["9b concession shown", /Concession : \*INR\.2,000\/-\*/],
      ["10 commencing date", /Commencing Date : \*1st September 2026 \(\w+day\)\*/],
      ["11 payment schedule", /Instalment 1: INR\.43,999\.50\/- — due 01-Sep-2026/],
      ["12 bank / payment details", /A\/C NO: 8055242956/],
      ["13 screenshot + Txn ID instruction", /share the screenshot after the payment with the Transaction ID/],
    ];
    for (const [, re] of el) expect(c).toMatch(re);
    console.log(`  ✓ all ${el.length} FR-SAL-32 elements present`);
  });
});

describe("#2 — editing the template (config) changes the draft, no code change / restart", () => {
  it("append a marker to the template, regenerate, and see it appear", async () => {
    const id = await readyLead(false, "suresh.c2@example.com", "9845010002");
    await generateDraft(mathiew, id);

    const before = await getDraftConfig();
    const MARKER = "*** TERMS: fees are non-refundable ***";
    await setDraftConfig(admin, { template: `${before.template}\n\n${MARKER}` });

    const regenerated = await generateDraft(mathiew, id);
    console.log(`\n  template marker present in regenerated draft: ${regenerated.content.includes(MARKER)}`);
    expect(regenerated.content).toContain(MARKER);

    await setDraftConfig(admin, { template: before.template }); // restore
  });
});

describe("#3 — generation with a missing pincode names the pincode", () => {
  it("blocks and the message names Pincode", async () => {
    const { id } = await createLead(mathiew, { fullName: "No Pincode", leadSource: TAG });
    await markInterested(mathiew, id);
    await updateBasicDetails(mathiew, id, { ...DETAILS, email: "suresh.c3@example.com", mobile: "9845010003", pincode: "626136" });
    await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    // Now blank the pincode directly to simulate an incomplete record.
    await prisma.lead.update({ where: { id }, data: { pincode: "" } });

    const blockers = await draftGenerationBlockers(id, mathiew);
    console.log(`\n  blockers: ${blockers.join(", ")}`);
    expect(blockers).toContain("Pincode");
    await expect(generateDraft(mathiew, id)).rejects.toThrow(/Pincode/);
  });
});

describe("#4 — regenerate: both versions retained and viewable", () => {
  it("v1 and v2 exist and v1 remains viewable", async () => {
    const id = await readyLead(false, "suresh.c4@example.com", "9845010004");
    const v1 = await generateDraft(mathiew, id);
    const v2 = await generateDraft(mathiew, id);
    const versions = await listDraftVersions(mathiew, id);
    const v1view = await getDraftVersion(mathiew, id, 1);
    console.log(`\n  versions present: [${versions.map((v) => v.version).join(", ")}]  |  v1 viewable: ${v1view.version === 1}`);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(v1view.content).toMatch(/Suresh Kumar/);
  });
});

describe("#5 — one call produces the draft (speed)", () => {
  it("generateDraft is a single service call", async () => {
    const id = await readyLead(false, "suresh.c5@example.com", "9845010005");
    const t0 = performance.now();
    await generateDraft(mathiew, id);
    const ms = Math.round(performance.now() - t0);
    console.log(`\n  single generateDraft() call took ${ms} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
