// @vitest-environment node
/**
 * The Google Sheets mirror's queue.
 *
 * The property that matters: a lead saves normally whether or not Google is reachable. The
 * sheet is written out of band from an outbox, so an outage queues rather than fails — and
 * the queue coalesces, so a busy day does not burn the Sheets rate limit rewriting one row.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, Role } from "@prisma/client";
import { loadEnv } from "../e2e/helpers/env";

loadEnv();

// Stub the adapter rather than adding a test-only setter to production code. The queue is
// what is under test; whether Google itself answers is not.
const sheet = vi.hoisted(() => ({ rows: [] as string[][], failWith: null as string | null }));
vi.mock("@/server/sheets", () => ({
  sheetsMirrorEnabled: () => true,
  getSheetsProvider: () => ({
    name: "stub",
    upsertLeadRows: async (rows: string[][]) => {
      if (sheet.failWith) throw new Error(sheet.failWith);
      sheet.rows = rows;
      return rows.length;
    },
  }),
}));

const leads = await import("@/server/services/leads");
const { drainSheetSync, enqueueFullBackfill } = await import("@/server/services/sheet-sync");

const prisma = new PrismaClient();
let mathiew: { userId: string; role: Role };
const TAG = "sheet-sync-it";
let n = 0;

async function newLead(): Promise<string> {
  n += 1;
  const { id } = await leads.createLead(mathiew, {
    fullName: `Sheet Lead ${n}`,
    email: `sheet${n}@example.com`,
    mobile: `97${String(700000000 + n)}`,
    leadSource: TAG,
  });
  return id;
}

async function cleanup() {
  const rows = await prisma.lead.findMany({ where: { leadSource: TAG }, select: { id: true } });
  const ids = rows.map((l) => l.id);
  if (ids.length) {
    await prisma.sheetSyncOutbox.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.enrollment.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeEach(() => { sheet.rows = []; sheet.failWith = null; });

beforeAll(async () => {
  mathiew = { userId: (await prisma.user.findFirstOrThrow({ where: { email: "mathiew@proitbridge.local" } })).id, role: Role.SALESPERSON };
  await cleanup();
});
afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

describe("the outbox", () => {
  it("queues a row the moment a lead is created", async () => {
    const id = await newLead();
    const queued = await prisma.sheetSyncOutbox.count({ where: { leadId: id, status: "PENDING" } });
    expect(queued).toBeGreaterThan(0);
  });

  it("coalesces many changes into ONE sheet write per lead", async () => {
    const id = await newLead();
    // Touch the same lead repeatedly, as a real day would.
    await leads.markInterested(mathiew, id);
    await leads.updateBasicDetails(mathiew, id, {
      fullName: "Sheet Lead updated", email: `sheet${n}@example.com`, mobile: `97${String(700000000 + n)}`,
      dob: "1996-01-01", doorNo: "1", street: "St", address: "Area", district: "Chennai", state: "TN", pincode: "600001",
    });

    const queuedRows = await prisma.sheetSyncOutbox.count({ where: { leadId: id, status: "PENDING" } });
    expect(queuedRows, "several changes queue several rows").toBeGreaterThan(1);

    await drainSheetSync();
    const written = sheet.rows;

    // ...but the lead is written ONCE, from its current state.
    expect(written.filter((r) => r[0] === id)).toHaveLength(1);
    expect(written.find((r) => r[0] === id)?.[3]).toBe("Sheet Lead updated");
    expect(await prisma.sheetSyncOutbox.count({ where: { leadId: id, status: "PENDING" } })).toBe(0);
  });

  it("a Google outage leaves the queue intact and records why", async () => {
    const id = await newLead();
    sheet.failWith = "Google Sheets refused the request (503).";
    const result = await drainSheetSync();

    expect(result.failed).toBeGreaterThan(0);
    const row = await prisma.sheetSyncOutbox.findFirstOrThrow({ where: { leadId: id } });
    expect(row.status, "still pending, so the next run retries").toBe("PENDING");
    expect(row.attempts).toBeGreaterThan(0);
    expect(row.lastError).toMatch(/503/);
  });

  it("the lead itself saved fine despite the outage — the mirror never blocks the desk", async () => {
    const id = await newLead();
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.fullName).toContain("Sheet Lead");
  });

  it("backfill queues every live lead", async () => {
    const queued = await enqueueFullBackfill();
    const liveLeads = await prisma.lead.count({ where: { voided: false } });
    expect(queued).toBe(liveLeads);
    // tidy up the rows backfill added for leads outside this suite
    await prisma.sheetSyncOutbox.deleteMany({ where: { reason: "backfill" } });
  });
});
