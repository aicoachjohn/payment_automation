# Payment Integrity & Reconciliation (FR-REC-01 … FR-REC-18)

Phase 11 deliverable. This maps every FR-REC control to its implementation and its test.
"A payment figure in this system can only be created by a salesperson, confirmed by
Nandhiya against a proof, changed only by sending it back through both, and never
deleted." (FRD §13)

Two layers:

- **Part A — prevention (FR-REC-01…10):** built in earlier phases; audited here with a
  test each. The month cannot drift silently in the first place.
- **Part B — detection (FR-REC-11…18):** built in this phase. If anything ever does
  drift, it is surfaced the same day.

---

## Part A — Prevention controls

| Control | What it guarantees | Implementation | Test |
|---|---|---|---|
| **FR-REC-01** | Transaction ID unique at the **database** level; a duplicate at submission names the lead + payment already holding it | DB `@unique`: `prisma/schema.prisma:267`; duplicate handler: `src/server/services/payments.ts:214-219` | `tests/integration/phase6.verify.test.ts` (#2) |
| **FR-REC-02** | No approval without explicitly confirming amount, date and Txn ID against the proof, each recorded | `assertPaymentApprovable` gate: `src/server/services/audit-decisions.ts:70-76`; the three confirmations are written as separate audit fields in `writeApproval` (`:111-113`) | `tests/integration/audit.integration.test.ts`; `tests/unit/permissions.test.ts` |
| **FR-REC-03** | A variance between received and expected blocks approval until accepted with a written reason | `src/server/services/audit-decisions.ts:80-82` (approval) and `payments.ts:146-148` (capture) | `tests/integration/audit.integration.test.ts` |
| **FR-REC-04** | Any payment taking approved received above the Final Approved Fee is blocked; over-collection needs a Super Admin override | `src/server/services/audit-decisions.ts:85-92` | `tests/integration/audit.integration.test.ts` |
| **FR-REC-05** | Probable duplicate (same lead, amount, date within the window) warned at submission **and** again at approval | submission: `payments.ts:151-160` (returns `probableDuplicate`); approval: `audit-decisions.ts:379` (`getAuditRecord.probableDuplicate`) | `tests/integration/phase11.verify.test.ts` (FR-REC-05) |
| **FR-REC-06** | Balance and every total computed server-side from stored approved records; never accepted from the browser, never stored as a standalone figure | the ONE balance fn `calculateBalance`: `src/server/money/index.ts:157`; totals recomputed in `src/server/services/finance.ts` | `tests/integration/finance.integration.test.ts` |
| **FR-REC-07** | Exact decimal everywhere; **no floating point on money** outside `src/server/money` | all money is `Prisma.Decimal`; the only sanctioned `number` from money is `toPaise` (geometry only): `src/server/money/index.ts:56-63` | `tests/unit/no-float-money.test.ts` (greps the whole tree) |
| **FR-REC-08** | One documented rounding rule (half-up, 2dp, applied once) across GST, draft, dashboards and exports | `round`: `src/server/money/index.ts:52`; `decomposeInclusive` for GST | `tests/unit/money.test.ts` |
| **FR-REC-09** | A payment is immutable once approved; change only by reopening the audit decision | DB trigger `prevent_approved_payment_edit`: `prisma/migrations/20260812130000_payment_immutability/migration.sql:4`; correction path is the Super Admin `REVERSE_AUDIT` override | `tests/integration/audit.integration.test.ts`; `tests/integration/phase9.verify.test.ts` (#2) |
| **FR-REC-10** | No payment/proof/audit entry is ever deleted; an error is **voided** with a mandatory reason, excluded from all totals, permanently visible in history | `VOID_PAYMENT` override: `src/server/services/overrides.ts:437` (routed through the single `performOverride` funnel); audit/super-admin-activity are DB-level append-only | `tests/integration/phase11.verify.test.ts` (FR-REC-10) |

---

## Part B — Detection controls (built in Phase 11)

All in `src/server/services/reconciliation.ts`. The nightly run is wired into the daily
automation tick (`src/server/services/automation.ts` → `reconciliationPass`) and is
runnable on demand from the Super Admin console (`/admin/reconciliation`).

| Control | What it does | Implementation | Test |
|---|---|---|---|
| **FR-REC-11** | Daily check: for every active enrollment, `sum(approved) + outstanding balance == Final Approved Fee` (violated exactly when the approved sum exceeds the fee) | `runReconciliation`: `reconciliation.ts:114` | `phase11.verify.test.ts` (#1) |
| **FR-REC-12** | Any failing enrollment is raised as an exception to the Super Admin **and** Rajesh, naming the record + discrepancy; open/acknowledged/resolved lifecycle with a resolution note | `raiseException`: `reconciliation.ts:49`; lifecycle: `listExceptions`/`acknowledgeException`/`resolveException`; model `ReconciliationException` | `phase11.verify.test.ts` (#1 — asserts both roles notified) |
| **FR-REC-13** | Independently verify the Finance Dashboard collection total for a period equals the sum of the individual records — via a **separate** aggregate query, so it can catch a dashboard-query bug | `verifyFinanceTotal`: `reconciliation.ts:146` (DB `aggregate` vs the dashboard's `findMany`+`sum`) | `phase11.verify.test.ts` (#5 asserts trace == dashboard) |
| **FR-REC-14** | Orphan report: payment without a proof; approved payment with no audit entry; payment whose lead was voided; (proof-without-payment is FK-impossible) | `orphanReport`: `reconciliation.ts:176` | `phase11.verify.test.ts` (#2) |
| **FR-REC-15** | Month-end statement: opening outstanding, approved-in-period by type, voids/reversals, closing outstanding — every figure reconciling to the records, drillable | `monthEndStatement`: `reconciliation.ts:227`; drill-down via the trace links on `/admin/reconciliation` | `phase11.verify.test.ts` (#3 — reconciles to a raw SQL sum) |
| **FR-REC-16** | Balance-change traceability: every total traces to the exact payment rows; a "trace this number" view | `traceCollection`/`traceEnrollment`: `reconciliation.ts:296` / `:316`; UI `/finance/trace` reached from every Finance total | `phase11.verify.test.ts` (#5) |
| **FR-REC-17** | Monthly exceptions report to Rajesh: approvals outside working hours, Super Admin money overrides, voided payments | `monthlyExceptionsReport`: `reconciliation.ts:347` | covered by `phase11.verify.test.ts` (void + override rows present) |
| **FR-REC-18** | The system never silently auto-adjusts money; every correction is explicit, attributed and reasoned | there is no money-mutating service without an `actor`; reasoned corrections go through `performOverride` (mandatory reason) | `phase11.verify.test.ts` (FR-REC-18 — empty-reason void refused) |

---

## Verify Phase 11 — where each check is proven

1. **Tamper `received_amount` → exception to SA + Rajesh** — `phase11.verify.test.ts` #1.
2. **Payment with no proof → orphan report** — `phase11.verify.test.ts` #2.
3. **Month-end statement reconciles to a raw SQL sum** — `phase11.verify.test.ts` #3.
4. **No floating-point on money outside `src/server/money`** — `tests/unit/no-float-money.test.ts`.
5. **Trace a total → exactly the rows that sum to it** — `phase11.verify.test.ts` #5.
