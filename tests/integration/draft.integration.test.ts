// @vitest-environment node
/**
 * Phase 5 — payment draft: blocked generation names the missing fields; the fee is
 * locked on generation; regeneration creates v2 while v1 is retained (FR-SAL-13/23/35/36).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, LeadStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { createLead, markInterested, selectCourse, updateBasicDetails } = await import("@/server/services/leads");
const { generateDraft, draftGenerationBlockers, listDraftVersions, DraftError } = await import("@/server/services/draft");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
const TAG = "phase5-it";

const FULL_DETAILS = {
  fullName: "Priya Sharma", dob: "1998-05-20", doorNo: "12A", street: "MG Road", address: "Indiranagar",
  district: "Bengaluru", state: "Karnataka", pincode: "560038", email: "priya.p5@example.com", mobile: "9812340000",
};

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true, enrollment: { select: { id: true } } } });
  const enrollmentIds = leads.map((l) => l.enrollment?.id).filter(Boolean) as string[];
  if (enrollmentIds.length) await prisma.paymentDraft.deleteMany({ where: { enrollmentId: { in: enrollmentIds } } });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function newLeadWithCourse() {
  const { id } = await createLead(mathiew, { fullName: "Priya Sharma", leadSource: TAG });
  await markInterested(mathiew, id);
  await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
  return id;
}

describe("blocked generation names the missing fields (FR-SAL-13)", () => {
  it("lists Pincode (and the other missing basic fields) and refuses generation", async () => {
    const id = await newLeadWithCourse();
    const blockers = await draftGenerationBlockers(id, mathiew);
    expect(blockers).toContain("Pincode");
    expect(blockers).toContain("Email");
    await expect(generateDraft(mathiew, id)).rejects.toThrow(/Pincode/);
    await expect(generateDraft(mathiew, id)).rejects.toBeInstanceOf(DraftError);
  });
});

describe("generation locks the fee and advances the lead (FR-SAL-23/35)", () => {
  it("first generation locks the fee, stores v1 with all details, status → PAYMENT_DRAFT_GENERATED", async () => {
    const id = await newLeadWithCourse();
    await updateBasicDetails(mathiew, id, FULL_DETAILS);

    const draft = await generateDraft(mathiew, id);
    expect(draft.version).toBe(1);

    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { leadId: id } });
    expect(enrollment.feeLockedAt).not.toBeNull(); // fee locked
    expect(enrollment.finalApprovedFee?.toFixed(2)).toBe("89999.00");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.status).toBe(LeadStatus.PAYMENT_DRAFT_GENERATED);

    // Content carries the key elements (ProITbridge house style).
    expect(draft.content).toMatch(/Priya Sharma/);
    expect(draft.content).toMatch(/Pincode : 560038/);
    expect(draft.content).toMatch(/Course Fee : \*INR\.89,999\/-\*/);
    expect(draft.content).toMatch(/Instalment 1: INR\.44,999\.50\/-/);
    expect(draft.content).toMatch(/Transaction ID/);
  });
});

describe("regeneration creates v2 and retains v1 (FR-SAL-36)", () => {
  it("a second generation yields v2 while v1 remains viewable", async () => {
    const id = await newLeadWithCourse();
    await updateBasicDetails(mathiew, id, { ...FULL_DETAILS, email: "priya.p5b@example.com", mobile: "9812340001" });

    const v1 = await generateDraft(mathiew, id);
    const v2 = await generateDraft(mathiew, id);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    const versions = await listDraftVersions(mathiew, id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]); // both retained, newest first
    expect(versions[1].content).toMatch(/Priya Sharma/); // v1 still viewable
  });
});
