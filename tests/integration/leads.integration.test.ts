// @vitest-environment node
/**
 * Phase 4 — lead lifecycle: ownership enforcement, duplicate detection, and the
 * system-driven status pipeline. server-only is stubbed by the integration config.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PrismaClient, Role, LeadStatus } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const {
  createLead, getLeadForActor, updateBasicDetails, markInterested, selectCourse,
} = await import("@/server/services/leads");
const { AuthorizationError } = await import("@/server/auth/permissions");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
let kevin: { userId: string; role: Role };
const TAG = "phase4-it";

async function cleanup() {
  const leads = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await prisma.payment.deleteMany({ where: { enrollment: { leadId: { in: ids } } } });
    await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  const m = await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } });
  const k = await prisma.user.findFirstOrThrow({ where: { email: "kevin@proitbridge.local" } });
  mathiew = { userId: m.id, role: Role.SALESPERSON };
  kevin = { userId: k.id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("ownership — a salesperson cannot read or edit another's lead (FR-SAL-01)", () => {
  it("Kevin is refused Mathiew's lead by direct read AND by a direct action", async () => {
    const { id } = await createLead(mathiew, { fullName: "Owned by Mathiew", leadSource: TAG });

    await expect(getLeadForActor(kevin, id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      updateBasicDetails(kevin, id, {
        fullName: "Hijack", dob: "2000-01-01", doorNo: "1", street: "s", address: "a",
        district: "d", state: "st", pincode: "560001", email: "x@y.com", mobile: "9876543210",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Mathiew (the owner) can read it.
    const lead = await getLeadForActor(mathiew, id);
    expect(lead.fullName).toBe("Owned by Mathiew");
  });
});

describe("duplicate detection (FR-SAL-10)", () => {
  it("blocks a second active lead with the same mobile and names the owner", async () => {
    await createLead(mathiew, { fullName: "First", mobile: "9811100011", leadSource: TAG });
    await expect(
      createLead(kevin, { fullName: "Second", mobile: "9811100011", leadSource: TAG }),
    ).rejects.toThrow(/already exists.*owned by/i);
  });
});

describe("status pipeline advances in FRD §3.4 order (FR §3.4)", () => {
  it("NEW_LEAD → INTERESTED → BASIC_DETAILS_RECEIVED, driven by data not by hand", async () => {
    const { id } = await createLead(mathiew, { fullName: "Pipeline Lead", leadSource: TAG });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).status).toBe(LeadStatus.NEW_LEAD);

    await markInterested(mathiew, id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).status).toBe(LeadStatus.INTERESTED);

    await updateBasicDetails(mathiew, id, {
      fullName: "Pipeline Lead", dob: "1999-05-05", doorNo: "9", street: "Main", address: "Central",
      district: "Chennai", state: "TN", pincode: "600001", email: "pipe@line.com", mobile: "9822200022",
    });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).status).toBe(LeadStatus.BASIC_DETAILS_RECEIVED);

    // Course selection computes the fee from the engine (no hand-typed fee).
    await selectCourse(mathiew, id, { program: "COMBO_ALL_THREE", plan: "PREMIUM", comboMode: "DOUBLE_SHOT" });
    const e = await prisma.enrollment.findFirstOrThrow({ where: { leadId: id } });
    expect(e.finalApprovedFee?.toFixed(2)).toBe("89999.00");
  });
});
