# UAT Evidence Pack (Phase 12, FRD §15.1 + §9)

Reproduce with:

```bash
pnpm test:integration acceptance      # FRD 15.1 criteria 6–14
pnpm test:integration business-rules  # BR-01..BR-30 (criterion 17)
pnpm test                             # unit incl. money, permissions, no-float, no-hardcoded-params
```

Every test is titled with the criterion/rule it proves, so the run output IS the evidence.

## FRD §15.1 acceptance criteria — `tests/integration/acceptance.test.ts` (9/9 pass)

| # | Criterion | Result |
|---|---|---|
| 6 | Eight individual accounts; each role sees only permitted data | **PASS** |
| 7 | Lead → draft with no manual fee calc; Combo single/double × Advanced/Premium | **PASS** |
| 8 | Payment + screenshot + Txn ID → Nandhiya's queue as Pending Audit | **PASS** |
| 9 | Approve / correction(reason) / reject(reason); salesperson notified each time | **PASS** (rejection-notify gap found & fixed) |
| 10 | Approved shows the full statement on Finance; non-approved does not | **PASS** |
| 11 | Customer data sheet auto-populated; exports to Excel/CSV in column order | **PASS** |
| 12 | Audit history: submitter, auditor, decisions, reasons, field-level before/after | **PASS** |
| 13 | Super Admin reverses with reason; cannot edit amount/Txn ID; Rajesh notified | **PASS** |
| 14 | Duplicate Txn ID rejected at DB; over-collection blocked; reconciliation clean | **PASS** |
| 15 | Independent penetration test completed & findings closed | **NOT DONE** — external; pack in `SECURITY_REVIEW.md` (D-09) |
| 16 | Full DB + payment-proof restore tested from backup | **PROCEDURE READY, NOT EXECUTED against prod** — `scripts/restore-test.sh` (run drill at go-live) |
| 17 | All 30 business rules pass | **PASS** — see below |

## Business rules BR-01..BR-30 — `tests/integration/business-rules.test.ts` (29/29 pass)

All thirty rules assert green (BR-09 and BR-10 share one test). Highlights:

- BR-06 unique Txn ID at DB level; BR-15 no Finance bypass; BR-22 balance from approved
  only; BR-24 no money-field edit capability exists; BR-25 override reasoned+logged+
  reported (append-only proven at the DB level); BR-26 void-not-delete (DELETE on
  `audit_trail` refused by the DB); BR-27 three confirmations; BR-28 computed totals;
  BR-29 exact decimal; BR-30 daily reconciliation exception.

## Supporting invariants (unit)

- `money.test.ts` — the rounding rule and Decimal arithmetic.
- `permissions.test.ts` — 130 RBAC cells + the inviolable invariants.
- `no-float-money.test.ts` — FR-REC-07: zero float-on-money outside `src/server/money`.
- `no-hardcoded-params.test.ts` — NFR-16: no price/GST literal in the calculation layer.

## Totals at Phase 12

**253 unit + 151 integration tests pass; lint, typecheck and `next build` clean.**
