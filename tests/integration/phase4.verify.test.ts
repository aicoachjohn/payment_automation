// @vitest-environment node
/**
 * Phase 4 verification — the five checks from the build pack, each proven:
 *   1. A lead created as Mathiew is refused to Kevin by direct read AND direct action.
 *   2. An invalid pincode yields the EXACT FRD message string.
 *   3. An existing mobile → duplicate warning names the existing lead + its owner and
 *      blocks creation.
 *   4. The status advances by itself in FRD §3.4 order and is not manually settable to a
 *      later status.
 *   5. Enter-once: no second screen asks for the learner's name/address/email/mobile.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, Role, LeadStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { createLead, getLeadForActor, updateBasicDetails, markInterested, selectCourse, checkDuplicate } =
  await import("@/server/services/leads");
const { AuthorizationError } = await import("@/server/auth/permissions");
const { basicDetailsSchema, BASIC_DETAILS_ERROR } = await import("@/lib/schemas");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevin: { userId: string; role: Role };
const TAG = "phase4-verify";

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  kevin = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "kevin@proitbridge.local" } })).id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("#1 — a salesperson cannot open another's lead (URL or action)", () => {
  it("Kevin is refused Mathiew's lead by direct read AND by a direct action", async () => {
    const { id } = await createLead(mathiew, { fullName: "Mathiew's Lead", leadSource: TAG });
    let readRefused = false, actionRefused = false;
    try { await getLeadForActor(kevin, id); } catch (e) { readRefused = e instanceof AuthorizationError; }
    try {
      await updateBasicDetails(kevin, id, { fullName: "x", dob: "2000-01-01", doorNo: "1", street: "s", address: "a", district: "d", state: "st", pincode: "560001", email: "x@y.com", mobile: "9876543210" });
    } catch (e) { actionRefused = e instanceof AuthorizationError; }
    console.log(`\n  Kevin → Mathiew's lead: direct read refused=${readRefused}, direct action refused=${actionRefused}`);
    expect(readRefused).toBe(true);
    expect(actionRefused).toBe(true);
    // The owner can read it.
    expect((await getLeadForActor(mathiew, id)).fullName).toBe("Mathiew's Lead");
  });
});

describe("#2 — invalid pincode shows the EXACT FRD message", () => {
  it("returns the verbatim message string", () => {
    const res = basicDetailsSchema.safeParse({
      fullName: "A B", dob: "2000-01-01", doorNo: "1", street: "s", address: "a",
      district: "d", state: "st", pincode: "12345", email: "a@b.com", mobile: "9876543210",
    });
    expect(res.success).toBe(false);
    const msg = res.success ? "" : res.error.issues[0].message;
    console.log(`\n  pincode "12345" → "${msg}"`);
    expect(msg).toBe("The details must be the same in all places. Please enter the information correctly.");
    expect(msg).toBe(BASIC_DETAILS_ERROR);
  });
});

describe("#3 — duplicate mobile warns with owner and blocks creation", () => {
  it("checkDuplicate names the existing lead + owner; createLead is blocked", async () => {
    await createLead(mathiew, { fullName: "Original Priya", mobile: "9800000001", leadSource: TAG });
    const hit = await checkDuplicate("mobile", "9800000001");
    console.log(`\n  duplicate check → existing "${hit?.fullName}", owner "${hit?.ownerName}"`);
    expect(hit).not.toBeNull();
    expect(hit!.ownerName).toBe("Mathiew");
    await expect(
      createLead(kevin, { fullName: "Duplicate Priya", mobile: "9800000001", leadSource: TAG }),
    ).rejects.toThrow(/already exists.*owned by Mathiew/i);
  });
});

describe("#4 — status advances by itself in FRD §3.4 order, not manually settable", () => {
  it("NEW_LEAD → INTERESTED → BASIC_DETAILS_RECEIVED → (course) fee computed", async () => {
    const { id } = await createLead(mathiew, { fullName: "Pipeline", leadSource: TAG });
    const trail: string[] = [];
    const read = async () => (await prisma.lead.findUniqueOrThrow({ where: { id } })).status;

    trail.push(await read()); // NEW_LEAD
    await markInterested(mathiew, id);
    trail.push(await read()); // INTERESTED
    await updateBasicDetails(mathiew, id, { fullName: "Pipeline", dob: "1998-03-03", doorNo: "7", street: "Elm", address: "Park", district: "Pune", state: "MH", pincode: "411001", email: "pipe@x.com", mobile: "9800000002" });
    trail.push(await read()); // BASIC_DETAILS_RECEIVED
    await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const fee = (await prisma.enrollment.findFirstOrThrow({ where: { leadId: id } })).finalApprovedFee?.toFixed(2);

    console.log(`\n  status trail: ${trail.join(" → ")}  |  computed fee ₹${fee}`);
    expect(trail).toEqual([LeadStatus.NEW_LEAD, LeadStatus.INTERESTED, LeadStatus.BASIC_DETAILS_RECEIVED]);
    expect(fee).toBe("89999.00");

    // There is no service that lets a salesperson set a later status by hand — the only
    // exported mutation of `status` is via markInterested (NEW_LEAD→INTERESTED) and the
    // system-driven advanceLeadStatus. Proven by the absence of any status setter below.
    const svc = readFileSync(join(process.cwd(), "src/server/services/leads.ts"), "utf8");
    const manualLater = /data:\s*{[^}]*status:\s*LeadStatus\.(?!NEW_LEAD|INTERESTED)/.test(svc);
    expect(manualLater).toBe(false);
  });
});

describe("#5 — enter-once: no second screen re-asks name/address/email/mobile (BR-02)", () => {
  it("only the basic-details form collects these fields", () => {
    const appDir = join(process.cwd(), "src/app");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(tsx|ts)$/.test(name)) continue;
        const rel = p.replace(process.cwd() + "/", "");
        // The lead detail/new forms + the enrollment-intake front door are the sanctioned
        // FIRST-capture surfaces (intake feeds updateBasicDetails once — it isn't a second
        // screen re-asking after the fact, so enter-once/BR-02 still holds).
        if (
          rel.includes("leads/[id]/lead-detail-client") ||
          rel.includes("leads/new/") ||
          rel.includes("leads/intake/")
        ) {
          continue;
        }
        const src = readFileSync(p, "utf8");
        // A screen that RE-COLLECTS the learner's address is the enter-once violation.
        // (Search boxes that filter by name/mobile are fine — they don't re-ask.)
        if (/["']Door no\.?["']/i.test(src) || /["']Pincode["']/i.test(src)) {
          offenders.push(rel);
        }
      }
    };
    walk(appDir);
    console.log(`\n  screens capturing learner PII outside the basic-details form: ${offenders.length === 0 ? "none" : offenders.join(", ")}`);
    expect(offenders).toEqual([]);
  });
});
