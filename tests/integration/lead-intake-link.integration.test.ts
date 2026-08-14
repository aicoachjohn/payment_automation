// @vitest-environment node
/**
 * Public self-intake link — a salesperson mints a single-use, expiring link; the lead
 * self-fills the strict form; a new lead is created owned by that salesperson. Verifies the
 * happy path, single-use consumption, and expiry. Touches no payment/money path.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PrismaClient, Role, Program, Plan } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

const { createIntakeInvite, submitIntake, isIntakeTokenValid } = await import("@/server/services/lead-intake-link");
const { isBasicComplete } = await import("@/server/services/leads");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const rawOf = (url: string) => url.split("/intake/")[1];
const createdLeadIds: string[] = [];
const tokenHashes: string[] = [];

function strictData(email: string, mobile: string) {
  return {
    fullName: "Self Fill Learner", dob: "1996-05-20", doorNo: "7B", street: "Anna Nagar",
    address: "7B Anna Nagar, Chennai", district: "Chennai", state: "Tamil Nadu", pincode: "600040",
    email, mobile, interestedProgram: Program.AGENTIC_AI_GENAI, interestedPlan: Plan.PREMIUM,
  };
}

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
});
afterAll(async () => {
  if (createdLeadIds.length) {
    await prisma.leadIntakeInvite.deleteMany({ where: { createdLeadId: { in: createdLeadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
  }
  if (tokenHashes.length) await prisma.leadIntakeInvite.deleteMany({ where: { tokenHash: { in: tokenHashes } } });
  await prisma.$disconnect();
});

describe("lead self-intake link", () => {
  it("mints a link, the lead self-fills → a complete lead owned by the salesperson", async () => {
    const { url, expiresAt } = await createIntakeInvite(mathiew, "for Ravi");
    const raw = rawOf(url);
    tokenHashes.push(sha256(raw));
    expect(url).toContain("/intake/");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await isIntakeTokenValid(raw)).toBe(true);

    const res = await submitIntake(raw, strictData("selffill1@example.com", "9800000001"), "203.0.113.7");
    expect(res.ok).toBe(true);

    const invite = await prisma.leadIntakeInvite.findUniqueOrThrow({ where: { tokenHash: sha256(raw) } });
    expect(invite.usedAt).not.toBeNull(); // single-use consumed
    expect(invite.createdLeadId).not.toBeNull();
    createdLeadIds.push(invite.createdLeadId!);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: invite.createdLeadId! } });
    expect(lead.salespersonId).toBe(mathiew.userId); // owned by the inviting salesperson
    expect(isBasicComplete(lead)).toBe(true); // strict → full record present
    expect(lead.interestedProgram).toBe(Program.AGENTIC_AI_GENAI);
    expect(lead.interestedPlan).toBe(Plan.PREMIUM);
    expect(lead.leadSource).toBe("Self-intake link");

    // The link is now spent — a second submit is rejected, and the token reads invalid.
    expect(await isIntakeTokenValid(raw)).toBe(false);
    const again = await submitIntake(raw, strictData("selffill1b@example.com", "9800000002"), "203.0.113.7");
    expect(again.ok).toBe(false);
  });

  it("rejects an expired link", async () => {
    const { url } = await createIntakeInvite(mathiew);
    const raw = rawOf(url);
    tokenHashes.push(sha256(raw));
    await prisma.leadIntakeInvite.update({ where: { tokenHash: sha256(raw) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await isIntakeTokenValid(raw)).toBe(false);
    const res = await submitIntake(raw, strictData("expired@example.com", "9800000003"), null);
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown token", async () => {
    expect(await isIntakeTokenValid("deadbeef".repeat(8))).toBe(false);
    const res = await submitIntake("deadbeef".repeat(8), strictData("nope@example.com", "9800000004"), null);
    expect(res.ok).toBe(false);
  });
});
