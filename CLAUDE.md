# ProITbridge — Payment & Enrollment Automation Platform

**This file is the project constitution. Every session must read it before writing code.**
It encodes rules taken directly from the FRD (`docs/FRD_v1.2.pdf`, v1.2, 11 Aug 2026).
When a rule here and code disagree, the rule wins — fix the code.

---

## Product in one paragraph

A three-stage internal payment workflow: a **Salesperson** captures a lead and its
payments, **Nandhiya** (Data Management) verifies each payment against its uploaded
proof as **Level-1 approval**, and only then does the payment become visible to
**Rajesh** (Finance) as **read-only**. One nominated **Super Admin** sits above all
three with controlled override authority.

---

## The ten inviolable rules

1. **Finance sees nothing unapproved.** A payment record is invisible to Finance until
   Nandhiya approves it. There is no bypass path anywhere in the codebase. (BR-15)
2. **Money is always Decimal.** Money is ALWAYS `Prisma.Decimal` / PostgreSQL
   `NUMERIC(12,2)`. Never a JS `number`, never a float. All arithmetic goes through
   `src/server/money`. (BR-29, FR-REC-07)
3. **Totals are computed, never stored.** Totals and balances are ALWAYS computed
   server-side from individual approved payment records. Never stored as a standalone
   editable figure. Never accept a total from the browser. (BR-28, FR-REC-06)
4. **Balance definition.** Balance = `final_approved_fee` minus the sum of **APPROVED**
   received amounts. Pending and rejected payments never reduce the balance. (BR-22)
5. **Everything is audited, append-only.** Every state-changing action writes an
   immutable `AuditTrail` entry with actor, role, entity, field, previous value, new
   value, timestamp and IP. Audit entries are append-only — no update, no delete, for
   anyone including the Super Admin. (FR-AUD-01, FR-AUD-02, BR-14)
6. **Nothing is hard-deleted.** Users are deactivated; leads, payments, proofs and audit
   entries are voided with a reason and remain visible in history. (BR-21, BR-26, FR-SA-14)
7. **RBAC is server-side, every request.** Re-verify identity, role and record ownership
   on every single request. Hiding a UI button is never the control. (FR-SEC-02,
   FR-SEC-03, NFR-07)
8. **Super Admin cannot edit money fields.** The Super Admin can reverse a decision but
   can NEVER directly edit a payment amount, payment date or Transaction ID. Corrections
   travel back through Sales and Nandhiya. (FR-SA-08, BR-24)
9. **Transaction ID is globally unique.** Enforced by a database `UNIQUE` constraint —
   not by application logic alone. (FR-REC-01, BR-06)
10. **Everything is configuration-driven.** Every business parameter — prices,
    thresholds, reminder schedules, templates, the 15-day window, the GST percentage —
    is editable by the Super Admin without a code change. Nothing hard-coded.
    (NFR-16, BR-13)

---

## Money and rounding rule

- All monetary values are `NUMERIC(12,2)` in Postgres and `Prisma.Decimal` in code.
- **Rounding:** half-up to 2 decimal places, applied **once** at the end of a calculation
  chain, never intermediately. (FR-REC-08)
- **GST is 18%** and is read from the Pricing Master / `SystemConfig`, never a literal
  in code. All brochure prices are **GST-inclusive**, so the base fee is derived by
  extraction from the inclusive figure.
- **Display:** INR with Indian digit grouping — `₹1,24,999.00`. (NFR-14)
- **Dates** display as `DD-MMM-YYYY`.
- **Timestamps** are stored in UTC and displayed in IST.
- All money arithmetic and formatting lives in `src/server/money`. Nowhere else.

---

## The five roles

`SALESPERSON`, `SALES_MANAGER`, `DATA_MGMT_AUDITOR`, `FINANCE_REVIEWER`, `SUPER_ADMIN`.

- Finance is **read-only by design** (BR-18): `FINANCE_REVIEWER` has no write permission
  of any kind on payment data.
- Exactly **one active Super Admin** (BR-23). A second credential may exist only as a
  documented break-glass account; any login with it alerts the primary Super Admin and
  Rajesh.
- Named users from the FRD: Salespeople **Mathiew, Kevin, Dinesh, Hari**; Data Management
  **Nandhiya**; Finance **Rajesh**. A Sales Manager and the Super Admin are nominated
  (see Business Decisions Q-03).

### Role-Based Access Control matrix (FRD §2.2 — reproduced verbatim)

`C = Create, R = Read, U = Update, D = Delete/Deactivate, A = Approve, – = No access`

| Function | Salesperson | Sales Manager | Nandhiya (Data Mgmt) | Rajesh (Finance) | Super Admin |
|---|---|---|---|---|---|
| Own leads | C R U | R U | R | R | R U † |
| All team leads | – | R U | R | R | R U † |
| Learner basic details | C R U | R U | R | R | R |
| Payment draft generation | C R | C R | R | R | R |
| Payment record entry + proof upload | C R U \* | C R U | R | R | R |
| Edit an approved payment amount / Txn ID | – | – | – | – | – ‡ |
| Payment audit decision (L1) | – | – | **A** | – | – |
| Reverse / reopen an audit decision | – | – | – | – | A † |
| Finance payment statement | – | R | R | R | R |
| Complete customer data sheet | R (own) | R | R | R | R |
| Concession request | C R | C R A | – | R | R A † |
| Unlock a locked fee | – | A | – | – | A † |
| Pricing Master | – | R U | – | R | C R U D |
| User management and role assignment | – | – | – | – | C R U D |
| System configuration and templates | – | – | – | – | C R U D |
| Audit trail / history | R (own) | R | R | R | R (all) + export |
| Reports and exports | R (own) | R | R | R | R (all) |

**\*** A salesperson may edit a payment record **only** while its Audit Status is
`PENDING_AUDIT` or `CORRECTION_REQUIRED`. Once `APPROVED` or `REJECTED` the record is
locked to that salesperson.

**†** Super Admin override actions **always** require a mandatory written reason and
generate an immutable audit entry plus a notification to the affected role. They are
exceptional actions, not routine ones.

**‡** By deliberate design the Super Admin **cannot** directly edit a payment amount or
Transaction ID. To correct an approved payment, the Super Admin reopens the audit
decision and the record travels back through Sales and Nandhiya — so no financial figure
can ever change without both of them seeing it.

> `payment:audit` belongs to `DATA_MGMT_AUDITOR` only. The Super Admin obtains it solely
> through the explicit delegated-audit path (Phase 9), which stamps the record
> "Audited by Super Admin (delegated)".

---

## Audit status lifecycle

```
PENDING_AUDIT ──► APPROVED
              ├─► CORRECTION_REQUIRED ──► (salesperson fixes) ──► RESUBMITTED ──► PENDING_AUDIT
              └─► REJECTED
```

- `CORRECTION_REQUIRED` and `REJECTED` both require a **mandatory reason**. (BR-16)
- A salesperson may edit a payment **only** while it is `PENDING_AUDIT` or
  `CORRECTION_REQUIRED`. Once `APPROVED` or `REJECTED` the record is **locked** to them.
- `AuditStatus` enum: `PENDING_AUDIT`, `APPROVED`, `CORRECTION_REQUIRED`, `REJECTED`,
  `RESUBMITTED`.

---

## Coding conventions

- **Thin edges, fat services.** All business logic lives in `src/server/services`. Route
  handlers and server actions are thin: validate with Zod → check permission → call the
  service → return.
- **Audit inside the transaction.** Every service function that changes data takes an
  `actor` (user id + role) and writes its own audit entry inside the **same** database
  transaction as the change.
- **No raw SQL strings.** No string-concatenated SQL anywhere. Prisma or parameterised
  queries only. (FR-SEC-13)
- **Safe errors.** Every error message shown to a user says what is wrong and what to do
  next, and never leaks a stack trace, a file path or an internal id. (NFR-11, FR-SEC-30)
- **No secrets in transit.** Personal data, payment amounts and Transaction IDs never
  appear in a URL, a query string or a log line. (FR-SEC-31)
- **Mobile-first lists.** Every list view must be responsive and usable on a phone
  browser. (NFR-10)
- **Deny by default.** Every server action and route handler starts with
  authenticate → authorise → validate.
- **Zod is the boundary.** Every input has a Zod schema, shared between client and server;
  client validation is convenience only, server validation is the control.

### Where things live

```
src/app/(auth)/        login, forgot-password, reset-password
src/app/(sales)/        salesperson + sales manager dashboards
src/app/(datamgmt)/     Nandhiya's L1 audit dashboard
src/app/(finance)/      Rajesh's read-only finance dashboard
src/app/(superadmin)/   Super Admin console
src/app/api/            route handlers where server actions are not suitable
src/server/db/          Prisma client singleton
src/server/services/    all business logic, one file per domain
src/server/auth/        session, RBAC guard, permission matrix
src/server/audit/       audit-trail writer
src/server/money/       Decimal money type and rounding rule
src/server/storage/     payment-proof storage adapter
src/server/ocr/         OCR provider interface
src/server/notifications/ email / in-app notification dispatch
src/server/jobs/        background scheduled jobs
src/components/ui/      shadcn primitives
src/components/shared/  app-wide composed components
src/lib/                zod schemas, constants, formatters
tests/unit/  tests/e2e/  docs/  prisma/
```

---

## Business Decisions

Still awaiting the business's confirmation (`TODO-BUSINESS`). As of Phase 3 the FRD §17
fallback values are implemented as **configuration** (SystemConfig / Pricing Master),
editable by the Super Admin without a code change — so confirming a real value later is a
config edit, not a code change.

- **Q-02 — Concession approval threshold (per plan):** `TODO-BUSINESS` — configured as
  ₹2,000 or 10%, whichever is lower (SystemConfig `concession_threshold`, per plan).
- **Q-04 — Double Shot payment split:** `TODO-BUSINESS` — configured 50 / 50
  (SystemConfig `double_shot_split`).
- **Q-05 — Default payment schedule (no special arrangement):** `TODO-BUSINESS` —
  configured 40 / 40 / 20 (SystemConfig `payment_schedule_default`).
- **Q-03 — Nominated Sales Manager / single Super Admin:** `TODO-BUSINESS`
  (placeholder accounts seeded; to be named by the business).

---

## Stack (fixed — do not substitute)

Next.js 15 (App Router, TypeScript strict) · PostgreSQL 16 + Prisma · Tailwind CSS +
shadcn/ui · TanStack Table · Zod · next-safe-action · Vitest (unit) · Playwright (e2e) ·
pnpm · Docker Compose (Postgres + MinIO).

### Common commands

```bash
pnpm dev          # start the app
pnpm lint         # eslint
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright e2e tests
pnpm db:up        # docker: postgres + minio
pnpm db:down      # docker: stop
pnpm db:migrate   # prisma migrate dev   (Phase 1+)
pnpm db:seed      # prisma db seed        (Phase 1+)
pnpm db:studio    # prisma studio         (Phase 1+)
```

---

## Phase status

Update this checklist at the end of every phase.

- [x] **Phase 0** — Foundation & Project Constitution
- [x] **Phase 1** — Data Model, Money & Audit Core
- [x] **Phase 2** — Auth, RBAC & Security Baseline
- [x] **Phase 3** — Pricing Master & Fee Engine
- [x] **Phase 4** — Sales: Leads & Basic Details
- [x] **Phase 5** — Automatic Payment Draft Generator
- [x] **Phase 6** — Payment Capture, Proof Upload & OCR
- [x] **Phase 7** — Data Management Dashboard (L1 Audit)
- [x] **Phase 8** — Finance Dashboard
- [x] **Phase 9** — Super Admin Console & Audit Trail UI
- [x] **Phase 10** — Automation Engine
- [x] **Phase 11** — Reconciliation & Integrity
- [ ] **Phase 12** — Hardening, Testing, UAT & Deployment
