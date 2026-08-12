/**
 * Durable, idempotent job runner on the existing Postgres — no Redis, no extra service
 * (the fixed stack stays fixed). Idempotency is enforced by a UNIQUE `dedupeKey` per
 * (job, entity, IST date): the key is CLAIMED before the work runs, so running the same
 * job twice on the same day can never send two reminders or perform two transfers.
 * Every run is recorded with its outcome (FR job idempotency + logging).
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

export interface JobOutcome {
  ran: boolean;
  detail?: unknown;
}

/**
 * Run `fn` at most once for `dedupeKey`. Claims the key first (an insert that the unique
 * index makes atomic); if the claim collides, another run already owns this key and we
 * skip. Records SUCCESS or FAILED. A FAILED run keeps the key claimed — the point of the
 * rule is "never send twice", so we do not silently retry a partial send.
 */
export async function runOnce(jobName: string, dedupeKey: string, fn: () => Promise<unknown>): Promise<JobOutcome> {
  try {
    await db.jobRun.create({ data: { jobName, dedupeKey, status: "RUNNING" } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ran: false }; // already claimed → idempotent skip
    }
    throw e;
  }

  try {
    const detail = await fn();
    await db.jobRun.update({
      where: { dedupeKey },
      data: { status: "SUCCESS", detail: (detail ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
    return { ran: true, detail };
  } catch (e) {
    await db.jobRun.update({
      where: { dedupeKey },
      data: { status: "FAILED", detail: { error: (e as Error).message.slice(0, 300) } },
    });
    return { ran: false, detail: { error: (e as Error).message } };
  }
}

/** How many times a job actually ran (for tests + the job log). */
export async function jobRunCount(jobName: string, dedupeKey: string): Promise<number> {
  return db.jobRun.count({ where: { jobName, dedupeKey, status: "SUCCESS" } });
}
