"use server";

import { revalidatePath } from "next/cache";
import { authActionClient, withPermission } from "@/server/safe-action";
import {
  financeQueryCreateSchema,
  financeQueryCommentSchema,
  financeQueryIdSchema,
  financeDigestSchema,
  enrollmentIdSchema,
} from "@/lib/schemas";
import {
  raiseFinanceQuery,
  addFinanceQueryComment,
  resolveFinanceQuery,
  FinanceQueryError,
} from "@/server/services/finance-queries";
import { scheduleFinanceDigest } from "@/server/services/finance-digest";
import { customerPaymentHistory } from "@/server/services/finance";

/**
 * Finance server actions. IMPORTANT (BR-18): none of these mutate payment data. The
 * only writes are to the FinanceQuery thread (FR-FIN-10) and the user's own digest
 * schedule (FR-FIN-26) — both separate from any Payment row. tests/integration asserts
 * this by enumerating every action here and checking payment rows are untouched.
 */

const financeQuery = withPermission("finance:query");
const financeAny = withPermission("finance:read");

/** Raise a Finance Query against an approved payment (never edits the payment). */
export const createFinanceQueryAction = financeQuery
  .schema(financeQueryCreateSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const { queryId } = await raiseFinanceQuery(ctx.actor, parsedInput);
      revalidatePath("/finance/queries");
      return { ok: true as const, queryId };
    } catch (e) {
      if (e instanceof FinanceQueryError) return { ok: false as const, error: e.message };
      throw e;
    }
  });

/** Add a comment to a query thread (finance, auditor or owning salesperson). */
export const addFinanceQueryCommentAction = authActionClient
  .schema(financeQueryCommentSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      await addFinanceQueryComment(ctx.actor, parsedInput);
      revalidatePath("/finance/queries");
      return { ok: true as const };
    } catch (e) {
      if (e instanceof FinanceQueryError) return { ok: false as const, error: e.message };
      throw e;
    }
  });

/** Resolve (close) a query thread. */
export const resolveFinanceQueryAction = financeQuery
  .schema(financeQueryIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    await resolveFinanceQuery(ctx.actor, parsedInput.queryId);
    revalidatePath("/finance/queries");
    return { ok: true as const };
  });

/** Read-only: a customer's full payment history for the expandable master row (FR-FIN-16). */
export const customerHistoryAction = financeAny
  .schema(enrollmentIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const history = await customerPaymentHistory(ctx.actor, parsedInput.enrollmentId);
    return { ok: true as const, ...history };
  });

/** Schedule daily / monthly finance summary emails to oneself (queued for Phase 10). */
export const scheduleFinanceDigestAction = financeAny
  .schema(financeDigestSchema)
  .action(async ({ parsedInput, ctx }) => {
    await scheduleFinanceDigest(ctx.actor, parsedInput);
    revalidatePath("/finance/collections");
    return { ok: true as const };
  });
