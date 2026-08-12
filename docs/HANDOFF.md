# Session Handoff — ProITbridge Build

**Read this, then `CLAUDE.md` (constitution), then the two memory files, before writing code.**
Last completed: **Phase 8** (Finance Dashboard). Working tree: commit at end of phase. Next:
**Phase 9 — Super Admin Console & Audit Trail UI** (pack: search "PHASE 9"; FRD §8
FR-SA-01..20, FR-ADM-01..10, FR-AUD-01..05, BR-23..26).

---

## How this build works

- 13-phase build (0–12) driven by `docs/ProITbridge_ClaudeCode_Build_Prompt_Pack.md`.
  Each phase: read that pack's phase prompt verbatim, implement, then a separate
  **"Verify Phase N"** step proves the pack's checklist with real command output.
- The FRD is `docs/FRD_v1.2.pdf` (51 pages). It has **no local text extractor** — extract
  with the scratchpad venv: `~/…/scratchpad/venv/bin/python` + `pypdf`; the extracted text
  is cached at `~/…/scratchpad/frd.txt` (grep it by requirement ID, e.g. `FR-DM-20`).
- Commit at the end of each phase and each verify with the `Co-Authored-By: Claude Opus 4.8`
  trailer. One `git commit` per phase; branch is `main`.

## Environment quirks (also in memory: `proitbridge-build-env`)

- **Next pinned to 15** (not 16), TypeScript strict. `pnpm`. Node 25.
- **Docker/MinIO NOT installed.** Postgres is **Postgres.app v18 on :5432**, superuser
  `strephin` (trust auth, no password). App DB `proitbridge` with two roles:
  - `DATABASE_URL` → `proitbridge_app` (restricted runtime; UPDATE/DELETE revoked on
    `audit_trail` & `super_admin_activity`).
  - `DIRECT_URL` → `strephin` (migrations only).
- **Proof storage** uses a **local filesystem** provider (`.proof-storage/`, gitignored)
  because MinIO is unavailable; an S3 provider stub exists for Phase 12. `STORAGE_PROVIDER=local`.
- `pnpm` blocks build scripts: `pnpm-workspace.yaml` needs both `allowBuilds` (prisma/esbuild
  true, sharp/unrs-resolver false) and `onlyBuiltDependencies`. If deps change, `pnpm install --force`.
- **`prisma migrate reset` is blocked for AI agents.** To re-init from empty: drop/recreate the
  DB via psql, then `prisma migrate deploy` + `pnpm db:seed`.
- **`tsx` does not auto-load `.env`** — run DB scripts via `pnpm db:seed`/`prisma`, or prefix
  `set -a; . ./.env; set +a`.
- **Build gotcha:** `next dev` (preview/e2e) and `next build` share `.next`; if build fails
  with `PageNotFoundError /_document`, `rm -rf .next` and rebuild.

## Commands

```
pnpm test            # vitest unit (jsdom)        — tests/unit/**  + src/**/*.test.ts
pnpm test:integration# vitest node, real DB       — tests/integration/**  (server-only is aliased/stubbed)
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint .
pnpm build           # next build
pnpm db:seed         # reseed users/pricing/config
```
Integration tests import services via `await import(...)` and use `loadEnv()` from
`tests/e2e/helpers/env.ts`. They tag rows (e.g. `leadSource: "phaseN-it"`) and clean up in
`afterAll`. Seeded users: `mathiew|kevin|dinesh|hari@proitbridge.local` (SALESPERSON),
`nandhiya@` (DATA_MGMT_AUDITOR), `rajesh@` (FINANCE_REVIEWER), `sales.manager@`, `super.admin@`.
Seed password `ChangeMe#123` (super admin's was changed to `SuperAdmin#2026` during manual
verification; `must_change_password` true for the rest).

## Testing status (all green at Phase 8)

- **238 unit + 81 integration** pass; lint/typecheck/build clean.
  (Phase 8 added `finance.integration.test.ts` + `phase8.verify.test.ts`, and the
  permissions matrix grew to 130 cases for the new `finance:query` permission.)
- Each phase N has `tests/integration/phaseN.verify.test.ts` printing labeled proofs.
- **Browser-tool caveat:** live UI verification is flaky in this environment (React
  hydration lag makes the FIRST form submit after a compile no-op; super-admin login needs a
  couple retries). All logic is proven by the automated suites; use them as authoritative.
  Signed-token "tamper" tests must be deterministic (use `token + "a"`, not a last-char swap).

## Architecture conventions (from CLAUDE.md — obey these)

- **Money is always `Prisma.Decimal`**, `NUMERIC(12,2)`. All arithmetic/formatting in
  `src/server/money`. App display: `₹1,24,999.00` / `DD-MMM-YYYY` (`src/lib/format`).
  The **payment draft** uses ProITbridge house style (`INR.84,999/-`, `11th August 2026
  (Tuesday)`) via `formatDraftAmount`/`formatDateLong` — a documented exception.
- **Thin edges, fat services.** Logic in `src/server/services/*`. Route handlers/actions:
  validate (Zod, `src/lib/schemas.ts`) → authenticate → authorise → call service.
- **RBAC** is data in `src/server/auth/permissions.ts` (the FRD §2.2 matrix). Guards:
  `requirePermission`, `requireRecordAccess`, `canEditPaymentRecord`. Actions use
  `authActionClient` / `withPermission(perm)` from `src/server/safe-action.ts`. Errors are
  sanitised — never leak internals.
- **Audit inside the transaction:** `writeAudit(tx, …)` (one row per changed field);
  `audit_trail`/`super_admin_activity` are append-only (Prisma extension + DB REVOKE).
- **Sessions**: DB-backed (`src/server/auth/session.ts`) + signed `jose` cookie; edge
  `src/middleware.ts` role-gates `/sales /leads /audit /finance /admin` (403 on wrong role).

## What exists (services you'll reuse in Phase 9)

- `src/server/services/finance-visibility.ts` — **THE single predicate**
  `financeVisiblePaymentWhere()` / `isVisibleToFinance()` = `APPROVED && !voided`
  (FR-DM-20, BR-15). Every Finance read goes through this.
- `src/server/money` — `calculateBalance` (approved, non-voided only, BR-22), `sum`, `round`, etc.
- `src/server/services/audit-decisions.ts` — approve/correction/reject; `auditTimeline`
  (read-only history, `audit:read:all`); approved payments immutable (service + DB trigger).
- `src/server/services/payments.ts` — capture, proofs, `issueProofUrl` (signed), `getProofForActor`.
- `src/server/audit` — `writeAudit(tx, …)` append-only writer (`audit_trail` / `super_admin_activity`
  UPDATE/DELETE revoked). Phase 9's Audit Trail UI reads these tables.
- Data model: `SuperAdminActivity` model already exists for Phase 9 override logging.
- `src/components/shared/proof-viewer.tsx` — zoomable proof preview; `bar-chart.tsx` — dep-free a11y chart.
- `src/server/services/leads.ts` — leads, `dashboardSummary`, `advanceLeadStatus` (FRD §3.4 pipeline).

### Phase 8 (Finance) — what landed, for reuse

- `src/server/services/finance.ts` — **reads only** (statement, tiles, customer master,
  monthly summary, GST, outstanding, trend, `financePaymentDetail`, `customerPaymentHistory`,
  `listSalespeople`). All on `financeVisiblePaymentWhere()`. Totals always recomputed, never stored.
- `finance-queries.ts` (FR-FIN-10 thread, the ONE Finance write — to `FinanceQuery`, never a
  Payment), `finance-export.ts` (CSV + PDF via pdf-lib, logs every export to `audit_trail`),
  `finance-digest.ts` (FR-FIN-26, queues `notification` rows for Phase 10).
- New permission `finance:query` (FINANCE_REVIEWER + SUPER_ADMIN). New models `FinanceQuery` /
  `FinanceQueryComment` (migration `20260812134938_phase8_finance_query`, app-role grants included).
- `src/lib/finance-columns.ts` — column specs shared by the on-screen tables AND the CSV export
  (guarantees FR-FIN-15 identical order). Client-safe (type-only import of the server row types).
- Routes: `(finance)/finance` (statement + tiles), `/customers`, `/collections`, `/queries`,
  `/payments/[paymentId]` (read-only audit history + raise-query).
- **BR-15 nuance settled:** the statement + ALL totals are approved-only; non-approved payments
  appear ONLY in the customer history expansion and the payment-detail audit timeline (badged,
  `countedInTotals:false`) — that is the FR-FIN-09/16 transparency the verify #5 relies on.

## Business decisions still open (config-driven placeholders, `TODO-BUSINESS`)

Q-02 concession threshold (₹2,000 or 10% lower), Q-04 double-shot 50/50, Q-05 default
40/40/20, Q-03 nominated Sales Manager / Super Admin, Q-01 WhatsApp send (flag OFF). All live
in `SystemConfig`, editable by Super Admin.
