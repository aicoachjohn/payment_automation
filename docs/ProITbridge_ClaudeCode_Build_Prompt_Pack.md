# ProITbridge Payment & Enrollment Automation Platform
## Claude Code Build Prompt Pack — v1.0

**Source:** FRD v1.2 (11 August 2026), 51 pages, ~200 requirement IDs
**Target stack:** Next.js 15 (App Router) + TypeScript + PostgreSQL + Prisma + Tailwind/shadcn-ui
**External services:** stubbed behind provider interfaces in Phase 6/10, swapped for real keys in Phase 12

---

## How to use this pack

1. Create an empty folder, `cd` into it, run `claude`.
2. Paste **Phase 0** first. It creates the repo, the `CLAUDE.md` constitution, and the folder skeleton. Everything after depends on it.
3. Run **one phase per Claude Code session**. At the end of each phase, run `/clear` before starting the next one — long context makes Claude Code slower and sloppier.
4. Before every phase, drop the FRD PDF into the project root as `docs/FRD_v1.2.pdf` so Claude Code can re-read any requirement by ID.
5. After each phase, run the **Verify** block. Do not move to the next phase until it passes.
6. Commit at the end of every phase: `git add -A && git commit -m "Phase N: <name>"`.

### Phase map

| Phase | Name | FRD coverage | Est. sessions |
|---|---|---|---|
| 0 | Foundation & Project Constitution | §14, NFR-16 | 1 |
| 1 | Data Model, Money & Audit Core | §10, BR-28/29, FR-AUD-01..05, FR-SEC-19 | 1–2 |
| 2 | Auth, RBAC & Security Baseline | FR-AUTH-01..11, FR-SEC-01..09, NFR-05/07 | 2 |
| 3 | Pricing Master & Fee Engine | FR-SAL-14..31, FR-ADM-01..09, BR-01..04/13/19 | 2 |
| 4 | Sales — Leads & Basic Details | FR-SAL-01..13, BR-02 | 2 |
| 5 | Payment Draft Generator | FR-SAL-32..37, FR-ADM-06 | 1 |
| 6 | Payment Capture, Proof Upload & OCR | FR-SAL-38..48, FR-SEC-20..26, BR-05/06/20 | 2 |
| 7 | Data Management Dashboard (L1 Audit) | FR-DM-01..45, BR-15..17/27 | 2–3 |
| 8 | Finance Dashboard | FR-FIN-01..26, BR-18 | 2 |
| 9 | Super Admin Console & Audit Trail UI | FR-SA-01..20, FR-ADM-10, BR-23..26 | 2 |
| 10 | Automation Engine | FR-SAL-49..71, BR-07..12 | 2 |
| 11 | Reconciliation & Integrity | FR-REC-01..18, BR-30 | 1–2 |
| 12 | Hardening, Testing, UAT & Deployment | §11, §12.4–12.6, §15.1 | 2–3 |

**Total realistic estimate: 22–28 Claude Code sessions.**

---

## Decisions you must make before Phase 3

The FRD leaves 13 open points (§17). These four block the build. Answer them now and paste your answers into `CLAUDE.md` under "Business Decisions":

| Q | Question | Needed by |
|---|---|---|
| Q-02 | Concession approval threshold per plan (₹ or %) | Phase 3 |
| Q-04 | Double Shot payment split — two equal instalments, or a defined ratio? | Phase 3 |
| Q-05 | Default payment schedule when no special arrangement applies | Phase 5 |
| Q-03 | Who is the nominated Sales Manager and the single Super Admin? | Phase 2 |

If you do not have these yet, use these placeholders and mark them `TODO-BUSINESS` in code so they are easy to find later: Q-02 = ₹2,000 or 10%, whichever is lower; Q-04 = 50/50 split; Q-05 = 40% / 40% / 20%.

---

# PHASE 0 — Foundation & Project Constitution

**Goal:** repo, stack, folder structure, and a `CLAUDE.md` that every later phase obeys.

### Prompt — copy from here

```
You are building the ProITbridge Payment & Enrollment Automation Platform, an internal
web application specified in docs/FRD_v1.2.pdf (51 pages). Read that PDF now — at
minimum sections 1, 2, 3, 9, 10, 11, 12 and 13 — before you write any code.

This is PHASE 0 of a 13-phase build. In this phase you set up the foundation ONLY.
Do not implement any business feature. Do not create any dashboard.

## Stack (fixed — do not substitute)
- Next.js 15, App Router, TypeScript strict mode
- PostgreSQL 16 + Prisma ORM
- Tailwind CSS + shadcn/ui components
- TanStack Table for all data grids
- Zod for every input schema, shared between client and server
- next-safe-action (or equivalent) so every server action validates and authorises
- Vitest for unit tests, Playwright for end-to-end tests
- pnpm as the package manager
- Docker Compose for local Postgres and MinIO (S3-compatible object storage)

## What to create in this phase

1. Initialise the Next.js project with TypeScript, Tailwind, ESLint, App Router,
   and the src/ directory.

2. Create this folder structure with a .gitkeep or an index barrel in each:
   src/app/(auth)/           - login, forgot-password, reset-password
   src/app/(sales)/          - salesperson + sales manager dashboards
   src/app/(datamgmt)/       - Nandhiya's L1 audit dashboard
   src/app/(finance)/        - Rajesh's read-only finance dashboard
   src/app/(superadmin)/     - Super Admin console
   src/app/api/              - route handlers where server actions are not suitable
   src/server/db/            - prisma client singleton
   src/server/services/      - all business logic, one file per domain
   src/server/auth/          - session, RBAC guard, permission matrix
   src/server/audit/         - audit trail writer
   src/server/money/         - Decimal money type and rounding rule
   src/server/storage/       - payment proof storage adapter
   src/server/ocr/           - OCR provider interface
   src/server/notifications/ - email/in-app notification dispatch
   src/server/jobs/          - background scheduled jobs
   src/components/ui/        - shadcn primitives
   src/components/shared/    - app-wide composed components
   src/lib/                  - zod schemas, constants, formatters
   tests/unit/
   tests/e2e/
   docs/
   prisma/

3. Set up Docker Compose with:
   - postgres:16 on port 5432, database proitbridge, with a named volume
   - minio for S3-compatible payment-proof storage on ports 9000/9001
   Add pnpm scripts: db:up, db:down, db:migrate, db:seed, db:studio.

4. Create .env.example with every variable the project will eventually need
   (DATABASE_URL, AUTH_SECRET, S3_*, OCR_PROVIDER, OCR_API_KEY, EMAIL_PROVIDER,
   EMAIL_API_KEY, APP_URL, SESSION_TIMEOUT_MINUTES, SUPERADMIN_SESSION_TIMEOUT_MINUTES).
   Add .env to .gitignore. NEVER put a real secret in any committed file — this is
   FR-SEC-12 and it is non-negotiable.

5. Write CLAUDE.md at the repo root. This is the project constitution that every
   future session will read. It must contain:

   ### Product in one paragraph
   A three-stage internal payment workflow: a Salesperson captures a lead and its
   payments, Nandhiya (Data Management) verifies each payment against its uploaded
   proof as Level-1 approval, and only then does the payment become visible to Rajesh
   (Finance) as read-only. One nominated Super Admin sits above all three with
   controlled override authority.

   ### The ten inviolable rules
   1. A payment record is invisible to Finance until Nandhiya approves it. There is
      no bypass path anywhere in the codebase. (BR-15)
   2. Money is ALWAYS Prisma Decimal / PostgreSQL NUMERIC(12,2). Never a JS number,
      never a float. All arithmetic goes through src/server/money. (BR-29, FR-REC-07)
   3. Totals and balances are ALWAYS computed server-side from individual approved
      payment records. Never stored as a standalone editable figure. Never accept a
      total from the browser. (BR-28, FR-REC-06)
   4. Balance = final_approved_fee minus the sum of APPROVED received amounts.
      Pending and rejected payments never reduce the balance. (BR-22)
   5. Every state-changing action writes an immutable AuditTrail entry with actor,
      role, entity, field, previous value, new value, timestamp and IP. Audit entries
      are append-only — no update, no delete, for anyone including the Super Admin.
      (FR-AUD-01, FR-AUD-02, BR-14)
   6. Nothing is ever hard-deleted. Users are deactivated; leads, payments, proofs and
      audit entries are voided with a reason and remain visible in history. (BR-21,
      BR-26, FR-SA-14)
   7. RBAC is enforced SERVER-SIDE on every single request, re-verifying identity,
      role and record ownership. Hiding a UI button is never the control. (FR-SEC-02,
      FR-SEC-03, NFR-07)
   8. The Super Admin can reverse a decision but can NEVER directly edit a payment
      amount, payment date or Transaction ID. Corrections travel back through Sales
      and Nandhiya. (FR-SA-08, BR-24)
   9. Transaction ID is unique across the entire system, enforced by a database
      UNIQUE constraint — not by application logic alone. (FR-REC-01, BR-06)
   10. Every business parameter — prices, thresholds, reminder schedules, templates,
       the 15-day window, the GST percentage — is configuration-driven and editable
       by the Super Admin without a code change. Nothing hard-coded. (NFR-16, BR-13)

   ### Money and rounding rule
   All monetary values are NUMERIC(12,2) in Postgres and Prisma.Decimal in code.
   Rounding: half-up to 2 decimal places, applied once at the end of a calculation
   chain, never intermediately. GST is 18% and read from the Pricing Master, never
   a literal in code. Display format: INR with Indian digit grouping (₹1,24,999.00).
   Dates display as DD-MMM-YYYY. All timestamps are stored UTC, displayed IST.

   ### The five roles
   SALESPERSON, SALES_MANAGER, DATA_MGMT_AUDITOR, FINANCE_REVIEWER, SUPER_ADMIN.
   The permission matrix is FRD section 2.2 — reproduce it as a table in this file.
   Finance is read-only by design (BR-18). Exactly one active Super Admin (BR-23).

   ### Audit status lifecycle
   PENDING_AUDIT -> APPROVED | CORRECTION_REQUIRED | REJECTED
   CORRECTION_REQUIRED -> (salesperson fixes) -> RESUBMITTED -> back to audit
   CORRECTION_REQUIRED and REJECTED both require a mandatory reason. (BR-16)
   A salesperson may edit a payment ONLY while it is PENDING_AUDIT or
   CORRECTION_REQUIRED. Once APPROVED or REJECTED the record is locked to them.

   ### Coding conventions
   - All business logic lives in src/server/services. Route handlers and server
     actions are thin: validate with Zod, check permission, call the service, return.
   - Every service function that changes data takes an `actor` (user id + role) and
     writes its own audit entry inside the same database transaction as the change.
   - No raw string-concatenated SQL anywhere. Prisma or parameterised queries only.
     (FR-SEC-13)
   - Every error message shown to a user says what is wrong and what to do next,
     and never leaks a stack trace, a file path or an internal id. (NFR-11, FR-SEC-30)
   - Personal data, payment amounts and Transaction IDs never appear in a URL, a
     query string or a log line. (FR-SEC-31)
   - Every list view must be responsive and usable on a phone browser. (NFR-10)

   ### Business Decisions (fill these in)
   Q-02 concession threshold: TODO-BUSINESS
   Q-04 Double Shot split: TODO-BUSINESS
   Q-05 default payment schedule: TODO-BUSINESS
   Q-03 nominated Sales Manager / Super Admin: TODO-BUSINESS

   ### Phase status
   A checklist of the 13 phases. Mark Phase 0 complete, the rest pending. Update
   this at the end of every phase.

6. Create docs/REQUIREMENTS_INDEX.md — a table listing every requirement ID group
   (FR-AUTH, FR-SAL, FR-DM, FR-FIN, FR-SA, FR-ADM, FR-AUD, FR-SEC, FR-REC, BR, NFR)
   with the phase that implements it, taken from the phase map I will give you in
   later prompts. For now list the ID groups and leave the phase column as TBD.

7. Initialise git, add a sensible .gitignore, and make the first commit.

## Do not
- Do not create any Prisma model yet — that is Phase 1.
- Do not create any page beyond a placeholder home route.
- Do not install any payment gateway, WhatsApp or accounting SDK. They are explicitly
  out of scope for Phase 1 (FRD 1.4.2).

When you are done, print a tree of what you created and confirm that
`pnpm dev`, `pnpm db:up` and `pnpm lint` all run clean.
```

### Verify Phase 0

- `pnpm dev` starts, `pnpm lint` passes, `docker compose up` brings Postgres and MinIO up.
- `CLAUDE.md` exists and contains all ten inviolable rules.
- No secret is committed anywhere. Run `git log -p | grep -iE "password|secret|key" ` and confirm nothing real appears.

---

# PHASE 1 — Data Model, Money & Audit Core

**Goal:** the database schema, the money type, and the audit writer. Everything else in the build sits on this.

### Prompt

```
PHASE 1 of the ProITbridge build. Read CLAUDE.md first, then section 10 (Indicative
Data Model), section 9 (Business Rules BR-01 to BR-30) and section 12.2 of
docs/FRD_v1.2.pdf.

Build the complete Prisma schema, the money module, and the audit trail core. No UI
in this phase.

## 1. Prisma schema

Implement these models exactly as FRD section 10 specifies, with the additions noted:

User            user_id, name, email (unique), mobile, password_hash, role,
                status (ACTIVE/DEACTIVATED), two_fa_enabled, two_fa_secret,
                failed_login_count, locked_until, must_change_password,
                created_at, last_login, created_by
Lead            lead_id, full_name, dob, door_no, street, address, district, state,
                pincode, email, mobile, lead_source, status (LeadStatus enum),
                salesperson_id, remarks, voided, voided_reason, created_at, updated_at
Enrollment      enrollment_id, lead_id (1:1), program, plan, combo_mode,
                commencing_date, batch, course_started_flag, standard_fee,
                concession_amount, concession_reason, concession_status,
                final_approved_fee, gst_percent, base_fee, gst_amount,
                fee_locked_at, pricing_id (the Pricing Master row used at lock time),
                enrollment_status, payment_schedule (Json)
Payment         payment_id, enrollment_id, payment_number (1/2/3), payment_type,
                expected_amount, received_amount, payment_date, payment_method,
                transaction_id (UNIQUE across the whole table), payment_status,
                audit_status, submitted_by, submitted_at, audited_by, audited_at,
                audit_reason_code, audit_comment, variance_reason,
                manual_entry_no_ocr (bool), voided, voided_reason, locked (bool)
PaymentProof    proof_file_id, payment_id, file_path, file_type, file_size,
                uploaded_by, uploaded_at, version, ocr_raw_output (Json),
                checksum_sha256, virus_scan_status, original_filename
PricingMaster   pricing_id, program, plan, advanced_fee, premium_fee,
                single_shot_fee, double_shot_fee, combo_fee, discount,
                concession_threshold_value, concession_threshold_type,
                gst_percent, effective_from, effective_to, special_pricing_flag,
                special_pricing_name, status, created_by, created_at
PaymentDraft    draft_id, enrollment_id, version, draft_content (text),
                draft_snapshot (Json — the field values used), generated_by,
                generated_at
AuditTrail      audit_id, entity_type, entity_id, action, field_name, old_value,
                new_value, performed_by, performed_by_role, performed_at,
                ip_address, user_agent, request_id
SuperAdminActivity activity_id, super_admin_id, override_type, entity_type,
                entity_id, reason_text, previous_state, new_state, performed_at,
                notified_to (String[])
Notification    notification_id, recipient_id, type, channel, subject, body,
                related_entity_type, related_entity_id, status, scheduled_at,
                sent_at, read_at, failure_reason
FollowUpTask    task_id, lead_id, assigned_to, due_date, description, status,
                completed_at, created_by
OperationsHandover handover_id, enrollment_id, handover_type (MANUAL/AUTO_DAY15),
                validated_flag, validation_errors (Json), handover_date,
                generated_by, snapshot (Json)
SystemConfig    key (unique), value (Json), description, updated_by, updated_at
SecurityEvent   event_id, event_type, user_id, ip_address, details (Json),
                created_at

## 2. Enums

Role: SALESPERSON, SALES_MANAGER, DATA_MGMT_AUDITOR, FINANCE_REVIEWER, SUPER_ADMIN
LeadStatus: the exact 13 values of FRD section 3.4, in order —
  NEW_LEAD, INTERESTED, BASIC_DETAILS_PENDING, BASIC_DETAILS_RECEIVED,
  PAYMENT_DRAFT_GENERATED, PAYMENT_PENDING, HOLDING_OR_STARTING_RECEIVED,
  DOWN_PAYMENT_PENDING, DOWN_PAYMENT_RECEIVED, FINAL_PAYMENT_PENDING,
  FULLY_PAID, ENROLLMENT_COMPLETED, OPERATIONS_HANDOVER
AuditStatus: PENDING_AUDIT, APPROVED, CORRECTION_REQUIRED, REJECTED, RESUBMITTED
PaymentType: COURSE_HOLDING, COURSE_STARTING, DOWN_PAYMENT, FINAL_PAYMENT
PaymentMethod: UPI, NEFT, IMPS, RTGS, CARD, CASH, OTHER
Program: DATA_ANALYST, ADV_DATA_SCIENCE_AI, AGENTIC_AI_GENAI, COMBO_ALL_THREE
Plan: ADVANCED, PREMIUM
ComboMode: SINGLE_SHOT, DOUBLE_SHOT
ConcessionStatus: NONE, AUTO_APPROVED, PENDING_APPROVAL, APPROVED, REJECTED

## 3. Database-level integrity (FR-SEC-19, FR-REC-01)

- UNIQUE constraint on Payment.transaction_id — at the database level, in the migration.
- Foreign keys with RESTRICT (never CASCADE delete) between Lead -> Enrollment ->
  Payment -> PaymentProof.
- NOT NULL on every mandatory financial field.
- CHECK constraint: received_amount >= 0, expected_amount >= 0, final_approved_fee > 0.
- Composite unique on (enrollment_id, payment_number).
- Index on: Payment.audit_status, Payment.submitted_at, Payment.audited_at,
  Lead.salesperson_id, Lead.mobile, Lead.email, AuditTrail.(entity_type, entity_id),
  AuditTrail.performed_at.
- All money columns must be @db.Decimal(12,2).

## 4. src/server/money

A small module that is the ONLY place money arithmetic happens:
- `money(value)` -> Prisma.Decimal
- `add`, `sub`, `mul`, `sum(list)` — all Decimal in, Decimal out
- `applyGst(baseFee, gstPercent)` and `extractBase(inclusiveFee, gstPercent)` —
  because all brochure prices in FRD 5.4.1 are GST-INCLUSIVE
- `round(value)` — half-up to 2dp, the single documented rounding rule (FR-REC-08)
- `formatINR(value)` — ₹1,24,999.00 with Indian digit grouping (NFR-14)
- `calculateBalance(finalApprovedFee, approvedPayments[])` — the ONLY balance
  function in the codebase. It must accept only APPROVED, non-voided payments.
Write unit tests for every function, including the GST extraction on all six
brochure prices in FRD 5.4.1 and both combo tables in 5.4.2.

## 5. src/server/audit

`writeAudit(tx, { entityType, entityId, action, changes[], actor, ip })` where
`changes` is an array of { field, oldValue, newValue }. It must:
- run inside the caller's Prisma transaction so an audit entry can never be missing
  for a change that succeeded
- write one row per changed field, so field-level before/after is queryable
  (FR-DM-34, FR-DM-35)
- serialise values as strings, never logging a full payload of personal data
Add a Prisma middleware or client extension that BLOCKS any update or delete on the
AuditTrail and SuperAdminActivity tables at runtime, throwing a clear error.
Additionally, in the migration, REVOKE UPDATE and DELETE on those two tables from
the application database role (FR-AUD-02, FR-SEC-11).

## 6. Seed script

prisma/seed.ts creating:
- One user per role with the exact names from the FRD: Mathiew, Kevin, Dinesh, Hari
  (SALESPERSON), one SALES_MANAGER, Nandhiya (DATA_MGMT_AUDITOR), Rajesh
  (FINANCE_REVIEWER), and one SUPER_ADMIN. Passwords from env, must_change_password
  set to true.
- The complete Pricing Master from FRD 5.4.1 and 5.4.2:
    Data Analyst           Advanced 24999   Premium 74999
    Adv Data Science & AI  Advanced 29999   Premium 79999
    Agentic AI + GenAI     Advanced 34999   Premium 89999
    Combo (all three)      Advanced: DoubleShot 34999 / SingleShot 31999
                           Premium:  DoubleShot 89999 / SingleShot 84999
  All GST-inclusive at 18%, effective_from today, status ACTIVE.
- SystemConfig defaults: down_payment_window_days=15,
  reminder_days=[3,7,10,13,14], audit_ageing_threshold_hours=48,
  gst_percent=18, session_timeout_minutes=30,
  superadmin_session_timeout_minutes=15, max_upload_mb=10,
  duplicate_payment_window_hours=24.

## 7. Deliverables
- A single initial migration that applies cleanly to an empty database.
- `pnpm db:migrate && pnpm db:seed` works end to end.
- All money unit tests pass.
- A short docs/DATA_MODEL.md explaining the four key relationships and why balance
  is never stored.
```

### Verify Phase 1

```
Verify Phase 1. Prove each of these with an actual command or test, not an assertion:
1. Inserting two payments with the same transaction_id fails at the DATABASE level.
2. An UPDATE on audit_trail is rejected by both the Prisma extension and the DB grant.
3. money.extractBase(24999, 18) rounds correctly and applyGst reverses it to 24999.00.
4. calculateBalance ignores PENDING_AUDIT and REJECTED payments.
5. Deleting a Lead that has an Enrollment is refused by the foreign key.
Show the commands and their output.
```

---

# PHASE 2 — Auth, RBAC & Security Baseline

**Goal:** individual logins, five roles, server-side permission enforcement, 2FA, session rules.

### Prompt

```
PHASE 2 of the ProITbridge build. Read CLAUDE.md, then section 4 (FR-AUTH-01 to
FR-AUTH-11), section 2.2 (the RBAC matrix), and section 12.1 (FR-SEC-01 to FR-SEC-09)
of docs/FRD_v1.2.pdf.

Build authentication, role-based access control and the security baseline. No
business dashboards yet — just the login, the routing, an empty role-appropriate
shell page per role, and the user-management screens.

## Authentication (FR-AUTH-01 to FR-AUTH-11)
- Email + password login. Individual credentials only. There is NO public signup and
  NO self-service registration route anywhere in the app — accounts are created only
  by the Super Admin (FR-SEC-01).
- Password policy: minimum 8 characters, at least one uppercase, one number, one
  special character. Forced change on first login (FR-AUTH-04).
- Argon2id password hashing (bcrypt acceptable fallback). Passwords are never logged,
  never returned by any API, never recoverable — only resettable (FR-SEC-04).
- Forgot-password: single-use, 30-minute email reset link. The token is stored hashed.
  The response is identical whether the email exists or not, to prevent enumeration
  (FR-AUTH-05).
- Session timeout: 30 minutes of inactivity for all roles, 15 minutes for SUPER_ADMIN
  (FR-AUTH-06, FR-SEC-06, NFR-07a). Read both from SystemConfig.
- Account lockout: 15 minutes after 5 consecutive failed attempts, and notify the
  Super Admin (FR-AUTH-07, FR-SEC-07).
- Rate limiting on login, forgot-password and OTP endpoints (FR-SEC-07).
- Two-factor authentication by email OTP: MANDATORY for SUPER_ADMIN,
  DATA_MGMT_AUDITOR and FINANCE_REVIEWER; available for all others
  (FR-AUTH-10, FR-SEC-05). In this phase, deliver the OTP via a console/dev logger
  behind the same NotificationProvider interface that Phase 10 will implement.
- Log every login, logout and failed login with user, IP and timestamp into
  SecurityEvent (FR-AUTH-09, FR-SEC-40).
- On logout, password change or role change, invalidate ALL that user's sessions
  server-side (FR-SEC-06, FR-SEC-08).
- Every Super Admin login sends a notification to Rajesh (NFR-07a).

## Role routing (FR-AUTH-03)
On successful login route the user directly to their own dashboard shell:
SALESPERSON and SALES_MANAGER -> /sales
DATA_MGMT_AUDITOR             -> /audit
FINANCE_REVIEWER              -> /finance
SUPER_ADMIN                   -> /admin
A user must never be able to reach another role's dashboard — enforce this in
middleware AND again inside every server action. A direct URL visit to a forbidden
route returns 403, not a redirect that leaks existence.

## The permission layer — this is the most important part of this phase
Create src/server/auth/permissions.ts holding the FRD section 2.2 matrix as DATA,
not as scattered if-statements. Model it as:

  type Permission = 'lead:create' | 'lead:read:own' | 'lead:read:all' |
    'lead:update:own' | 'lead:update:all' | 'payment:create' | 'payment:update:own' |
    'payment:audit' | 'payment:reverse-audit' | 'finance:read' | 'customer:read' |
    'concession:create' | 'concession:approve' | 'fee:unlock' | 'pricing:read' |
    'pricing:write' | 'user:manage' | 'config:write' | 'audit:read:own' |
    'audit:read:all' | 'audit:export' | 'report:read:own' | 'report:read:all'

Then a single ROLE_PERMISSIONS map, and one guard used everywhere:

  requirePermission(actor, 'payment:audit')
  requireRecordAccess(actor, lead)   // ownership check for :own permissions

Rules that must be encoded here, straight from the FRD footnotes:
- FINANCE_REVIEWER has NO write permission of any kind on payment data (BR-18).
- SUPER_ADMIN has NO 'payment:edit-amount' permission — that permission does not
  exist in the system at all (FR-SA-08, BR-24).
- A SALESPERSON may update a payment ONLY when its audit_status is PENDING_AUDIT or
  CORRECTION_REQUIRED, and only if they own the lead. Encode this as a function, not
  a comment.
- Only DATA_MGMT_AUDITOR has 'payment:audit'. SUPER_ADMIN gets it only through the
  explicit delegated-audit path built in Phase 9, which stamps the record
  "Audited by Super Admin (delegated)".
Write a unit test that walks the ENTIRE FRD 2.2 matrix cell by cell and asserts the
permission layer agrees with it. This test is the specification.

## User management (FR-AUTH-08, FR-AUTH-11)
Super Admin screens to create, edit, deactivate and reactivate users and assign roles.
Users are NEVER hard-deleted (BR-21). Deactivation revokes sessions immediately.
Enforce that exactly one ACTIVE SUPER_ADMIN exists (BR-23, FR-AUTH-11): a second
Super Admin credential may exist only as a documented break-glass account flagged
`is_break_glass`, and any login with it raises an alert to the primary Super Admin
and to Rajesh.
Every user-management action writes an audit entry.

## Security baseline (FR-SEC-02, FR-SEC-03, FR-SEC-27 to FR-SEC-31)
- Deny by default. Every server action and route handler starts with
  authenticate -> authorise -> validate.
- Set security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy no-referrer).
- CSRF protection on every state-changing operation.
- Zod validation server-side on every input; client validation is convenience only.
- Error responses never expose stack traces, SQL, file paths or internal ids.
- No personal data, amount or Transaction ID in any URL or log line.

## Deliverables
- Login, forgot-password, reset-password, first-login password change, OTP screen.
- Five role shell pages with the correct nav for that role and nothing more.
- Super Admin user-management screen.
- The permission matrix test, passing.
- docs/SECURITY.md recording which FR-SEC requirement is satisfied where.
```

### Verify Phase 2

```
Verify Phase 2 by attacking it. Write Playwright tests that prove:
1. A logged-in SALESPERSON requesting /finance and /admin gets 403.
2. A SALESPERSON calling the audit server action directly (bypassing the UI) is
   rejected server-side.
3. A FINANCE_REVIEWER cannot invoke any write action — enumerate every exported
   server action and assert Finance is refused by all of them.
4. Six failed logins locks the account for 15 minutes and alerts the Super Admin.
5. A session left idle past the timeout is rejected on the next request, and a
   SUPER_ADMIN session dies at 15 minutes while others live to 30.
6. The permission matrix test covers every cell of FRD 2.2 with no gaps.
Report any test that fails and fix it before declaring the phase done.
```

---

# PHASE 3 — Pricing Master & Fee Engine

**Goal:** the pricing engine. ~95% of leads take the Combo path, so that path must be the fastest and most reliable route.

### Prompt

```
PHASE 3 of the ProITbridge build. Read CLAUDE.md, then sections 5.3, 5.4, 5.5, 8.2
(FR-ADM-01 to FR-ADM-09) and business rules BR-01, BR-03, BR-04, BR-13, BR-19 of
docs/FRD_v1.2.pdf.

Build the Pricing Master admin module and the fee calculation engine. This is the
heart of the Sales module — no salesperson may ever compute a fee by hand for a
standard case (BR-01).

## Pricing Master (FR-ADM-01 to FR-ADM-09)
Super Admin CRUD over PricingMaster with every field from FRD 8.2: program,
advanced_fee, premium_fee, single_shot_fee, double_shot_fee, combo_fee, discount,
concession threshold, gst_percent, effective_from / effective_to, special pricing name.

Critical behaviours:
- Entries are EFFECTIVE-DATED. The engine applies the rate effective on the date the
  lead's fee is locked, not the rate that is current today (FR-ADM-02).
- A Pricing Master change NEVER retroactively alters a lead whose payment draft has
  already been generated (FR-ADM-03, FR-SAL-23). Prove this with a test.
- Editing a rate creates a NEW effective-dated row and closes the previous one; it
  never mutates history.
- Every change writes an audit entry with previous and new value (FR-ADM-04).
- Concession approval threshold is configurable PER PLAN (FR-ADM-05, FR-SAL-28).
- Programs and Plans can be added or retired without a code change (FR-ADM-08).
- Audit reason-code list is maintained here too (FR-ADM-09, FR-DM-17): seed it with
  Amount mismatch, Transaction ID incorrect, Proof unreadable, Duplicate payment,
  Wrong lead, Details mismatch.

## Fee engine — src/server/services/pricing.ts

calculateFee({ program, plan, comboMode, asOfDate }) returns:
  { pricingId, baseFee, gstPercent, gstAmount, standardFee }

Rules:
- Standard path: program + plan -> the brochure price. All brochure prices in FRD
  5.4.1 are GST-INCLUSIVE at 18%, so standardFee IS the inclusive figure and baseFee
  is derived by extraction, using src/server/money (FR-SAL-20, FR-SAL-22).
- Combo path: when program = COMBO_ALL_THREE, comboMode is MANDATORY (FR-SAL-16) and
  the fee comes from the combo table, correctly distinguishing Single Shot from
  Double Shot for BOTH Advanced and Premium (FR-SAL-21). Getting this wrong is the
  single most expensive bug in this system — write a test for all four combo cells:
  Advanced/Double 34999, Advanced/Single 31999, Premium/Double 89999,
  Premium/Single 84999.
- Manual fee entry is NOT permitted for standard cases (FR-SAL-20). The API must not
  accept a fee value from the client at all — it accepts selections and returns a fee.

applyConcession({ standardFee, concessionValue, concessionType, plan }) returns:
  { concessionAmount, finalApprovedFee, requiresApproval, concessionStatus }
- Concession may be a value or a percentage (FR-SAL-26).
- At or below the configured per-plan threshold -> AUTO_APPROVED.
  Above the threshold -> PENDING_APPROVAL, and the payment draft CANNOT be generated
  until a Sales Manager or Super Admin approves it (FR-SAL-27).
- Reason/remarks are MANDATORY on any concession (FR-SAL-26, BR-04).
- finalApprovedFee flows into the draft, the payment schedule, the balance and every
  downstream dashboard (FR-SAL-29).

lockFee(enrollmentId, actor)
- Called when the payment draft is generated. Snapshots pricing_id, base_fee,
  gst_amount, standard_fee, concession, final_approved_fee onto the Enrollment and
  sets fee_locked_at (FR-SAL-23).
- Once locked, the fee is immutable EXCEPT through unlockFee, which requires a
  documented reason plus Sales Manager or Super Admin approval, writes previous and
  new value to the audit trail, and forces the payment draft to be regenerated
  (FR-SAL-24, FR-SA-09, BR-19).

buildPaymentSchedule({ finalApprovedFee, courseStarted, comboMode, custom })
- Returns the instalment plan: amount and expected date per instalment.
- Default schedule from CLAUDE.md Business Decisions (Q-04, Q-05).
- Supports a fully custom schedule for special leads: number of instalments, amount
  and expected date per instalment (FR-SAL-31).
- The sum of instalments must equal finalApprovedFee exactly — assert this and fail
  loudly if it does not.

## UI in this phase
- Super Admin: Pricing Master list + effective-dated editor + reason-code manager +
  concession-threshold settings.
- A reusable <FeeBreakdown /> component showing Base Fee, GST (18%), Standard Fee
  (inclusive), Concession Amount and Final Approved Fee (FR-SAL-22). Phase 4 will
  embed it in the lead form.

## Deliverables
- 100% test coverage of the fee engine: all 6 standard cells, all 4 combo cells,
  concession value and percentage, at/above/below threshold, effective-dating across
  a rate change, and the "old lead keeps old price" case.
```

### Verify Phase 3

```
Verify Phase 3:
1. Print a table of every program+plan+combo combination with baseFee, gstAmount and
   standardFee, and confirm each inclusive figure exactly matches FRD 5.4.1/5.4.2.
2. Create a lead, lock its fee, then change the Pricing Master. Prove the locked lead's
   fee did not move and a new lead gets the new price.
3. Attempt to POST a hand-typed fee to the enrollment API. Confirm it is rejected.
4. Raise a concession above threshold and confirm the payment draft is blocked until
   approved.
5. Confirm every instalment schedule sums exactly to the final approved fee.
```

---

# PHASE 4 — Sales: Leads, Basic Details, Course & Plan

**Goal:** the salesperson's daily surface — create a lead, capture details once, choose program and plan.

### Prompt

```
PHASE 4 of the ProITbridge build. Read CLAUDE.md, then sections 5.1, 5.2, 5.3, and
3.4 (the 13-status lead pipeline), plus BR-02 of docs/FRD_v1.2.pdf.

Build the Sales Dashboard home and the lead lifecycle up to (but not including) the
payment draft.

## Sales Dashboard home (FR-SAL-01 to FR-SAL-06)
- A SALESPERSON sees ONLY their own leads by default (FR-SAL-01). Enforced in the
  query, not the UI.
- Summary tiles: Total Leads, Basic Details Pending, Payment Pending, Down Payment
  Pending, 15-Day Deadline Approaching, Fully Paid, Corrections Required, Total
  Collected (this month) (FR-SAL-02). Every tile is clickable and opens the
  corresponding filtered list.
- "My Pending Actions" list, ordered by urgency: Day-15 deadlines first, then
  corrections returned by Nandhiya, then payment follow-ups (FR-SAL-03).
- Searchable, filterable lead list. Filters: status, program, plan, payment status,
  audit status, commencing date range, lead source, date created (FR-SAL-04).
- SALES_MANAGER sees ALL leads across all four salespeople, with a salesperson
  filter, plus payments, balances, follow-ups, commencing dates and Operations
  handovers (FR-SAL-05).
- Per-salesperson performance strip: leads created, conversions, amount collected,
  pending balance for the selected period (FR-SAL-06).
- All totals on this page come from the server-side balance/collection service. The
  browser never computes a rupee figure.

## Lead creation and basic details (FR-SAL-07 to FR-SAL-13)
Mandatory fields (FR-SAL-08): Full Name, Date of Birth, Full Address, Door No.,
Street, District, State, Pincode, Email ID, Mobile No.

Validation (FR-SAL-09):
- Email format valid
- Mobile exactly 10 digits, optional country code
- Pincode exactly 6 digits
- DOB a valid past date
- On ANY validation failure, display this exact message, verbatim:
  "The details must be the same in all places. Please enter the information correctly."

Duplicate detection (FR-SAL-10, R-05):
- On mobile OR email match against an existing lead, warn immediately, show the
  existing lead and WHO OWNS IT, and block creation of a duplicate active enrollment.
- Run this check on blur of the mobile/email field, not only on submit.

Enter-once principle (FR-SAL-11, BR-02):
Basic details are captured once and reused automatically in the payment draft, the
audit record, the Finance customer view and the Operations handover. There must be
no second screen anywhere in this application that asks for a learner's name,
address, email or mobile again. Treat any such screen as a bug.

Also: Lead Source and free-text Remarks (FR-SAL-12).
Block payment-draft generation until every mandatory basic-detail field is complete
and valid (FR-SAL-13).

## Course and plan selection (FR-SAL-14 to FR-SAL-19)
- Program: Data Analyst / Advanced Data Science & AI / Agentic AI + GenAI /
  Combo Pack – All Three.
- Plan: Advanced (Group Mentoring) or Premium (One-on-One Mentorship).
- Combo Pack additionally requires payment mode: Single Shot or Double Shot, and
  applies the corresponding combo price (FR-SAL-16).
- Commencing Date selector; the chosen date flows automatically into the payment
  draft, the enrollment record and the Operations handover (FR-SAL-17).
- Capture whether the course has ALREADY STARTED at the time of the first payment —
  this determines the payment terminology and whether the 15-day rule applies
  (FR-SAL-18). Where a Commencing Date is set, derive this automatically and show it
  for confirmation.
- Optional batch information for the Operations handover (FR-SAL-19).
- On selection, call the Phase 3 fee engine and render <FeeBreakdown />. Include the
  concession request flow: value or percentage, mandatory reason, auto-approve at or
  below threshold, route above-threshold requests to the Sales Manager for approval
  (FR-SAL-25 to FR-SAL-30). Flag concession/special leads with a visible marker that
  will also appear on the Data Management and Finance dashboards (FR-SAL-30).

## Lead status pipeline (FRD 3.4)
The lead status is SYSTEM-DRIVEN. A salesperson can mark INTERESTED, but cannot set
any later status by hand. Implement a single transition function
`advanceLeadStatus(leadId, tx)` that recomputes the correct status from the actual
state of the enrollment and its payments, and call it after every relevant mutation.
Every transition writes an audit entry (FRD 3.2 rule 5).

## Deliverables
- Sales dashboard home with working tiles and filters.
- Lead create/edit form with the exact validation message.
- Duplicate warning showing the existing lead and its owner.
- Course/plan/combo selection wired to the Phase 3 fee engine.
- Concession request and approval flow.
- Tests: validation rules, duplicate detection, status transitions in order, and a
  test asserting a SALESPERSON cannot read another salesperson's lead.
```

### Verify Phase 4

```
Verify Phase 4:
1. Create a lead as Mathiew. Log in as Kevin and attempt to open it by direct URL and
   by direct server-action call. Both must be refused.
2. Enter an invalid pincode and confirm the exact FRD message string appears.
3. Enter an existing mobile number and confirm the duplicate warning names the
   existing lead and its owner and blocks creation.
4. Walk a lead through the pipeline and confirm the status advances by itself in the
   FRD 3.4 order and never skips or is manually settable.
5. Confirm nowhere in the app asks for the learner's name or address a second time.
```

---

# PHASE 5 — Automatic Payment Draft Generator

**Goal:** the one-click enrollment message. This is the feature that decides whether the sales team actually adopts the system (risk R-03).

### Prompt

```
PHASE 5 of the ProITbridge build. Read CLAUDE.md, then section 5.6 (FR-SAL-32 to
FR-SAL-37) and FR-ADM-06 of docs/FRD_v1.2.pdf.

Build the automatic payment draft generator. A salesperson must NEVER assemble this
text by hand — if using this feature is not faster than typing the message into
WhatsApp, the whole system fails to get adopted. Optimise for that.

## The draft (FR-SAL-32)
One click produces the complete, ready-to-send enrollment message containing:
- Enrollment Confirmation type (Regular / Special)
- Full Name, Date of Birth
- Full Address including Pincode
- Email ID, Mobile No.
- Program Name, Plan (and Combo mode where applicable)
- Course Fee / Final Approved Fee, with the concession shown when there is one
- Commencing Date
- Payment Schedule (instalment number, amount, expected date)
- Company bank / payment details
- The instruction to share the payment screenshot along with the Transaction ID

## Template management (FR-SAL-33, FR-ADM-06)
The template body and the company bank details are CONFIGURATION, stored in
SystemConfig and editable by the Super Admin. They are never hard-coded and never
require a deployment to change. Use a simple, safe placeholder syntax such as
{{learner.full_name}} / {{enrollment.final_approved_fee}} / {{schedule}}, rendered
server-side with escaping. Provide a live preview in the Super Admin template editor
using sample data, so a bad template is caught before it reaches a learner.

## Actions on the generated draft (FR-SAL-34)
- Copy to Clipboard (make this the primary, largest, fastest action)
- Download as PDF
- Send by Email
- Optional: a wa.me pre-filled WhatsApp link (FR-SAL-37, priority Could). Build it
  behind a SystemConfig feature flag, default OFF, pending decision Q-01.

## Guardrails
- Generation is BLOCKED until all mandatory basic details are complete and valid
  (FR-SAL-13) and until any above-threshold concession has been approved (FR-SAL-27).
  When blocked, list exactly which fields or approvals are missing — never a generic
  "cannot generate".
- On generation: call lockFee() from Phase 3, record who generated it and when, store
  the rendered content AND a JSON snapshot of the field values used, and advance the
  lead status to PAYMENT_DRAFT_GENERATED (FR-SAL-35, FR-SAL-23).
- Regeneration after an approved change is allowed and creates a NEW version row;
  every previous version is retained and viewable for audit (FR-SAL-36).
- Every generation and regeneration writes an audit entry.

## Deliverables
- Draft generator UI on the lead page with a large Copy to Clipboard button.
- Server-side PDF rendering of the draft.
- Email send through the NotificationProvider interface (still stubbed in this phase —
  it writes to the Notification table and logs; Phase 10 wires the real provider).
- Super Admin template editor with live preview.
- Version history viewer showing every draft version with its timestamp and author.
- Tests: blocked generation lists the exact missing fields; fee is locked on
  generation; regeneration creates v2 and preserves v1.
```

### Verify Phase 5

```
Verify Phase 5:
1. Generate a draft for a Combo Premium Double Shot lead with a concession. Read the
   output and confirm every one of the 13 FR-SAL-32 elements is present and correct.
2. Change the payment-draft template in the Super Admin console and regenerate.
   Confirm the change appears with no code change and no restart.
3. Attempt generation with a missing pincode and confirm the error names the pincode.
4. Regenerate and confirm both versions are retained and viewable.
5. Time yourself: from opening a lead to having the message on the clipboard. If it
   is more than about 15 seconds of interaction, simplify the flow.
```

---

# PHASE 6 — Payment Capture, Proof Upload & OCR Assist

**Goal:** "the sales team drops the screenshot and it pulls the details." Speed with a mandatory human confirmation.

### Prompt

```
PHASE 6 of the ProITbridge build. Read CLAUDE.md, then section 5.7 (FR-SAL-38 to
FR-SAL-48), section 12.3 (FR-SEC-20 to FR-SEC-26), and BR-05, BR-06, BR-20 of
docs/FRD_v1.2.pdf.

Build payment capture with proof upload and OCR assist. The design principle:
extraction gives the speed, mandatory human confirmation keeps it safe. No
unconfirmed auto-extracted number may ever reach Nandhiya or Rajesh.

## The payment record (FRD 5.7 field table)
- payment_number: SYSTEM-assigned 1 / 2 / 3.
- payment_type: SYSTEM-derived, never chosen by the user:
    course not started -> payment 1 = COURSE_HOLDING
    course started     -> payment 1 = COURSE_STARTING
    payment 2 = DOWN_PAYMENT, payment 3 = FINAL_PAYMENT
    if only two payments are ever received, payment 2 becomes the FINAL_PAYMENT
    when the balance reaches zero (BR-07, FR-SAL-54)
- expected_amount: SYSTEM-calculated from the final approved fee and the schedule.
- received_amount, payment_date, payment_method, transaction_id: entered or
  confirmed by the salesperson.
- payment_date is the actual date ON THE PROOF, not the upload date.
- balance: NEVER stored — always computed by money.calculateBalance.

## Mandatory rules
- Proof upload AND Transaction ID are BOTH mandatory on every payment record.
  Neither is skippable (FR-SAL-38, BR-05).
- Transaction ID must be unique system-wide. On a duplicate, reject and tell the user
  exactly WHICH lead and which payment already holds it (FR-SAL-43, FR-REC-01, BR-06).
  The database UNIQUE constraint from Phase 1 is the real enforcement; catch the
  constraint violation and translate it into that message.
- When received_amount differs from expected_amount: WARN, do not block, and require
  a written reason before submission (FR-SAL-44).
- On submission: recalculate the balance, advance the lead status, set audit_status to
  PENDING_AUDIT and place the record in Nandhiya's queue (FR-SAL-45, FR-SAL-48).

## OCR assist (FR-SAL-39 to FR-SAL-42, FR-SAL-47)
Create src/server/ocr/ with a provider INTERFACE:

  interface OcrProvider {
    extract(fileBuffer, mimeType): Promise<{
      fields: { receivedAmount?, paymentDate?, transactionId?, payerName?,
                paymentMethod? },
      confidence: Record<string, number>,
      raw: unknown
    }>
  }

Implement two providers now:
- MockOcrProvider — deterministic, used in dev and tests
- StubCloudProvider — the shape of a Google Cloud Vision / AWS Textract call, with
  the API call clearly marked TODO-INTEGRATION for Phase 12
Select by the OCR_PROVIDER env var. No provider name is referenced anywhere outside
this folder.

Behaviour:
- On upload, run OCR and pre-fill Received Amount, Payment Date, Transaction ID/UTR,
  payer name and payment method where detectable (FR-SAL-39).
- Display the extracted values ALONGSIDE the uploaded image, and require the
  salesperson to explicitly confirm or correct EACH value before submission. An
  auto-extracted value is never submitted unconfirmed (FR-SAL-40, BR-20). Implement
  this as a per-field confirm state, not a single blanket checkbox.
- Every field carries a confidence indicator; low-confidence fields are visually
  flagged for mandatory manual review (FR-SAL-41).
- Record, per field, whether the final value was OCR-accepted or manually overridden,
  and retain the raw OCR output for audit (FR-SAL-42).
- If OCR fails or the image is unreadable, allow full manual entry and flag the
  record "Manual Entry – No OCR" for the auditor's attention (FR-SAL-47).
- OCR must complete within 10 seconds; past that, let the salesperson continue
  manually (NFR-02). Never block the form on OCR.

## Proof storage and file security (FR-SAL-46, FR-SEC-20 to FR-SEC-26, NFR-15)
Create src/server/storage/ with a StorageProvider interface, implemented over S3/MinIO:
- Private storage only. Not publicly browsable, not guessable by URL, and NO direct
  public link exists (FR-SEC-20).
- Access is granted only via a SHORT-LIVED SIGNED URL issued after the requesting
  user's role and record access have been verified on that specific request
  (FR-SEC-21). Never issue a signed URL from a client-supplied path.
- Accept JPG, PNG, PDF only, validated server-side by ACTUAL FILE CONTENT (magic
  bytes), not by extension. Max 10 MB (FR-SEC-22, NFR-15).
- Virus/malware scan before the file is stored and made viewable (FR-SEC-23). Build
  it behind a ScanProvider interface with a pass-through dev implementation and a
  TODO-INTEGRATION marker.
- Store under system-generated names; keep the original filename as metadata only,
  never as the storage path (FR-SEC-24).
- Log every view, download and export of a proof with user, record and timestamp
  (FR-SEC-25).
- A replaced proof during a correction cycle creates a NEW VERSION. The previous
  version is retained and stays viewable in the audit history. Proofs are NEVER
  overwritten in place (FR-SEC-26, FR-DM-42).
- Store a SHA-256 checksum of every uploaded file.
- Proofs are viewable as a zoomable preview from the Data Management and Finance
  dashboards (FR-SAL-46, FR-DM-03).

## Deliverables
- Payment capture form: drag-and-drop upload, OCR pre-fill, side-by-side image and
  fields, per-field confirmation, confidence flags, duplicate-Txn-ID error naming the
  conflicting lead, variance warning with mandatory reason.
- Zoomable proof viewer component reused in Phases 7 and 8.
- Tests: duplicate Txn ID blocked at DB level; unconfirmed OCR field blocks submit;
  a .exe renamed to .jpg is rejected; an 11 MB file is rejected; a signed URL expires;
  a replaced proof keeps v1 viewable.
```

### Verify Phase 6

```
Verify Phase 6 adversarially:
1. Submit a payment with an OCR-extracted amount that was never confirmed. It must be
   refused server-side, not just disabled in the UI.
2. Reuse a Transaction ID from another lead. Confirm the error names that lead and
   payment.
3. Rename a text file to proof.jpg and upload it. Must be rejected on content.
4. Copy a proof's signed URL, wait for expiry, and open it. Must fail.
5. Log in as a salesperson who does not own the lead and request the proof URL
   directly. Must be refused.
6. Replace a proof and confirm version 1 is still viewable in history.
```

---

# PHASE 7 — Data Management Dashboard (Nandhiya, L1 Audit)

**Goal:** the approval gate. Nothing reaches Finance without passing through here.

### Prompt

```
PHASE 7 of the ProITbridge build. Read CLAUDE.md, then all of section 6 (FR-DM-01 to
FR-DM-45), section 3.2, and BR-15, BR-16, BR-17, BR-27 of docs/FRD_v1.2.pdf.

Build Nandhiya's Data Management Dashboard. This is the Level-1 approval gate and the
core control the platform exists to enforce.

## The audit queue (FR-DM-01 to FR-DM-08)
- One queue showing EVERY payment record submitted by all four salespeople
  (FR-DM-01).
- Each row shows: Lead Name, Mobile, Email, Lead Owner/Salesperson, Program, Plan,
  Payment Type, Payment Amount, Payment Date, Payment Method, and the Proof
  (FR-DM-02).
- The proof opens as a ZOOMABLE, DOWNLOADABLE preview directly BESIDE the entered
  values, so verification requires no screen switching (FR-DM-03). This layout is the
  whole ergonomic point of the screen — a side-by-side split view, image left, fields
  right, decision buttons bottom right.
- The record view also shows Expected Amount, Total Received to date and outstanding
  Balance for the lead, so a payment is never audited without its context (FR-DM-04).
- Sort and filter by salesperson, payment type, audit status, program, plan, payment
  date range and submission date range (FR-DM-05).
- Free-text search on Lead Name, Mobile, Email and Transaction ID (FR-DM-06).
- Visually highlight records flagged "Manual Entry – No OCR" and records where the
  received amount differs from the expected amount (FR-DM-07).
- New records appear in real time, or on a refresh interval of at most 60 seconds,
  without a re-login (FR-DM-08). Polling every 30s is acceptable; do not build
  websockets for this.

## Payment-type views (FR-DM-09 to FR-DM-13)
Dedicated views in addition to the combined queue:
- Course Holding Payment view
- First Payment view (Course Holding / Course Starting)
- Follow-up Payment view (Down Payment and Final Payment)
Each carries its own count, total value and pending-audit count, and offers the same
audit actions as the combined queue. Every view exports to Excel/CSV WITH THE APPLIED
FILTERS INTACT (FR-DM-12, FR-DM-13).

## The audit decision (FR-DM-14 to FR-DM-23)
Statuses: PENDING_AUDIT, APPROVED, CORRECTION_REQUIRED, REJECTED, RESUBMITTED.

- Nandhiya sets the decision per payment record INDIVIDUALLY — auditing is at payment
  level, not lead level. Payment 1 may be approved while Payment 2 is still pending
  (FR-DM-15, FRD 3.2 rule 2).
- CORRECTION_REQUIRED and REJECTED both require a mandatory comment/reason before the
  decision can be saved (FR-DM-16, BR-16). Offer the configurable reason-code list
  from Phase 3 alongside the free-text comment (FR-DM-17).
- APPROVAL IS GATED BY EXPLICIT CONFIRMATION (FR-REC-02, BR-27): Nandhiya cannot
  approve until she explicitly ticks that the Received Amount, the Payment Date and
  the Transaction ID each match the uploaded proof. Implement these as three separate
  required confirmations recorded individually in the audit history — not one combined
  checkbox.
- Approval is BLOCKED entirely if the proof is missing or the Transaction ID is blank
  (FR-DM-22).
- Where received differs from expected, approval is blocked until the difference is
  either corrected or explicitly accepted with a written reason recorded against the
  record (FR-REC-03).
- Block any payment that would take total approved received above the Final Approved
  Fee. Over-collection requires an explicit Super Admin override with a reason
  (FR-REC-04) — in this phase, block it and surface the override request; Phase 9
  builds the override itself.
- Warn on a probable duplicate payment — same lead, same amount, same payment date
  within the configurable window — both at submission and again at approval
  (FR-REC-05).
- CORRECTION_REQUIRED routes back to the ORIGINATING salesperson only, never
  reassigned, with a notification containing the reason (FR-DM-18, FRD 3.2 rule 4).
- On resubmission the status becomes RESUBMITTED and the record returns to the TOP of
  the queue, showing the previous and new values SIDE BY SIDE (FR-DM-19).
- ONLY on APPROVED is the payment published to the Finance Dashboard and counted in
  collection totals (FR-DM-20, BR-15). Implement this as a single query predicate used
  by every Finance read — there must be exactly one place in the codebase that decides
  what Finance can see.
- Bulk-approve multiple clean records in one action, with each record still logged
  individually (FR-DM-21). Bulk approve must apply the same blocking rules per record
  and report which records were skipped and why.
- REJECTED payments never reach Finance and are excluded from all collection totals,
  but remain permanently visible in the audit history (BR-17, FRD 3.2 rule 3).
- An approval decision is reversible ONLY by the Super Admin (FR-DM-23) — Phase 9.
- A payment becomes IMMUTABLE once approved (FR-REC-09). Enforce it in the service
  layer and with a database-level guard.

## Dashboard overview (FR-DM-24 to FR-DM-29)
Tiles with COUNT and TOTAL VALUE for: New payments received for audit, Pending audits,
Approved, Correction-required, Rejected, Resubmitted, and Payments pending for a long
period. Every tile clicks through to its filtered list (FR-DM-25).
"Pending for a long period" uses the configurable ageing threshold (default 48 hours),
escalating amber at the threshold and red at double it (FR-DM-26).
Period selector: Today / This Week / This Month / Custom Range, applying to all tiles
(FR-DM-27). Salesperson-wise breakdown of submissions and audit outcomes, so recurring
data-quality problems are visible (FR-DM-28). Total approved collection for the period,
split by payment type (FR-DM-29).

## Complete audit history (FR-DM-30 to FR-DM-45)
For every payment, a reverse-chronological timeline capturing: who submitted and when;
who edited, when and exactly which field changed with previous and updated value; who
audited, when, and the decision; the full correction comment; the complete resubmission
history including every cycle; and every version of the uploaded proof.
The timeline is expandable to field-level before/after (FR-DM-43).
It is IMMUTABLE — no user, including the Super Admin, can edit or delete an entry
(FR-DM-44).
It is exportable to PDF for any individual payment record, for dispute resolution
(FR-DM-45).

## Deliverables
- Split-view audit screen with keyboard shortcuts (A = approve, C = correction,
  R = reject, J/K = next/previous record). Nandhiya is the bottleneck risk (R-02) —
  every saved second matters.
- Payment-type views with exports.
- Overview tiles with ageing escalation.
- Immutable audit timeline component with PDF export.
- Tests for every blocking rule above.
```

### Verify Phase 7

```
Verify Phase 7. This phase carries the core control, so test it hard:
1. Approve a payment WITHOUT ticking the three match confirmations, by calling the
   server action directly. Must be refused.
2. Approve a payment whose proof is missing. Must be refused.
3. Save CORRECTION_REQUIRED with an empty reason. Must be refused.
4. Confirm a PENDING_AUDIT payment does not appear anywhere on the Finance dashboard
   and is not in any Finance total. Then approve it and confirm it appears.
5. Confirm a REJECTED payment is excluded from every total but still visible in
   history.
6. Approve a payment, then attempt to edit its amount as the salesperson, as the
   Sales Manager and as the Super Admin. All three must be refused.
7. Bulk-approve a batch containing one record with a missing proof. Confirm the batch
   completes, the bad record is skipped, and the reason is reported.
8. Grep the codebase for every Finance query and confirm they all route through the
   single approved-only predicate.
```

---

# PHASE 8 — Finance Dashboard (Rajesh, read-only)

**Goal:** answer three questions with no follow-up message to Sales — what has been paid, who paid it, what is the month's total.

### Prompt

```
PHASE 8 of the ProITbridge build. Read CLAUDE.md, then all of section 7 (FR-FIN-01 to
FR-FIN-26) and BR-18 of docs/FRD_v1.2.pdf.

Build Rajesh's Finance Dashboard. It is READ-ONLY BY DESIGN. There must be no write
path of any kind from this dashboard to payment data (BR-18). Every figure on it
derives solely from Nandhiya-approved, non-voided payment records.

## Daily approved payment statement (FR-FIN-01 to FR-FIN-10)
- A payment appears here IMMEDIATELY and AUTOMATICALLY when Nandhiya approves it.
  There is no manual forwarding step (FR-FIN-01).
- Default view: today's approved payments, with a date / date-range selector
  (FR-FIN-02).
- Each row shows the complete statement: Learner Name, Mobile, Email, Program, Plan,
  Payment Type, Payment Number (1/2/3), Expected Amount, Received Amount, Payment
  Date, Payment Method, Transaction ID, Payment Proof, Total Received to Date,
  Balance, Salesperson, Approved By, Approval Date & Time, Enrollment/Commencing Date
  (FR-FIN-03).
- The proof is viewable and downloadable directly from here, through the same
  signed-URL path built in Phase 6 (FR-FIN-04).
- Daily total, period total and record count for the selected range (FR-FIN-05).
- Records that are Pending Audit, Correction Required, Rejected or Resubmitted must
  NOT appear here and must NOT be in any Finance total (FR-FIN-06). Use the single
  approved-only predicate from Phase 7.
- A dashboard indicator for newly approved payments, plus an optional daily digest
  email (FR-FIN-07).
- Export to Excel/CSV and PDF with applied filters intact (FR-FIN-08).
- Rajesh can view the complete audit history of any payment, in read-only form
  (FR-FIN-09).
- Rajesh can raise a Finance Query against a record, sent to Nandhiya and the
  salesperson, WITHOUT altering any payment data (FR-FIN-10). Model this as a separate
  FinanceQuery entity with a thread of comments — it never touches the Payment row.

## Complete customer data (FR-FIN-11 to FR-FIN-18)
A master sheet of every enrolled customer, maintained automatically from the sales
record so it never depends on anyone sending a message (FR-FIN-11).
Columns (FR-FIN-12): Customer Name, Mobile, Email, Full Address (Door No., Street,
District, State, Pincode), Date of Birth, Program/Course, Plan, Combo mode, Commencing
Date, Standard Fee, Concession, Final Approved Fee, Total Received, Balance, Payment
Status, Enrollment Status, Salesperson, Enrollment Date.
- Updates automatically whenever the underlying lead or payment changes, with a
  "last updated" timestamp per row (FR-FIN-13).
- Searchable by name, mobile, email and Transaction ID; filterable by program, plan,
  salesperson, payment status, enrollment status and date range (FR-FIN-14).
- One-click Excel/CSV export in the SAME COLUMN ORDER as shown on screen (FR-FIN-15).
- Each row expands to the customer's full payment history: every payment, its type,
  amount, date, Transaction ID, proof and audit outcome (FR-FIN-16).
- Visually flag incomplete customer records — missing address, email or mobile — so
  they can be corrected before the month closes (FR-FIN-17).
- Configurable, saveable column selection for Rajesh's view (FR-FIN-18).

## Course-holding and follow-up payment records (FR-FIN-19 to FR-FIN-26)
- Dedicated views for Course-Holding Payments and for Follow-up Payments (Down Payment
  and Final Payment), in addition to the combined statement (FR-FIN-19).
- Monthly Collection Summary for any selected month: total approved collection; split
  by payment type (Course Holding, Course Starting, Down Payment, Final Payment); split
  by program; split by plan; split by salesperson (FR-FIN-20).
- The Monthly Collection Summary must be viewable with ZERO interaction with the sales
  team — all figures derive solely from approved records (FR-FIN-21).
- Outstanding Balance report: every learner with a balance greater than zero, showing
  amount outstanding, payment stage, days outstanding and responsible salesperson
  (FR-FIN-22).
- Month-on-month collection trend and a payment-type mix visualisation (FR-FIN-23).
- GST summary for the period showing the base value and the GST component of approved
  collections (FR-FIN-24).
- Every Finance report exports to Excel/CSV and PDF (FR-FIN-25).
- Rajesh can schedule a daily and a monthly summary email to himself (FR-FIN-26) —
  queue it through the notification service; Phase 10 delivers it.

## Overview tiles (FRD 7.4)
Approved Today (count + value); Collection This Month (with previous-month
comparison); Course Holding Payments; Follow-up Payments; Fully Paid Enrollments;
Total Outstanding; New Customers; Records Awaiting Audit (informational only, so
Rajesh knows what is still in the pipe).

## Hard constraints for this phase
- Enumerate every server action reachable from the Finance routes and assert in a test
  that each is read-only.
- Every export is logged with user, report, filters applied and record count
  (FR-AUD-05, FR-SEC-42).
- Charts: use a simple, accessible chart library; label axes; format all currency
  through money.formatINR.

## Deliverables
- Finance dashboard with overview tiles, daily statement, customer master sheet,
  payment-type views, monthly summary, outstanding report, GST summary, trend chart.
- Excel and PDF export for every view, filters intact.
- FinanceQuery thread feature.
- Tests proving read-only, proving totals equal the sum of underlying approved
  records, and proving non-approved records are absent from every figure.
```

### Verify Phase 8

```
Verify Phase 8:
1. For a month of seeded data, compute the expected total independently with a raw SQL
   query over approved payments, and assert it equals every figure the dashboard shows
   (daily total, monthly summary, tile, and export file).
2. Confirm the exported Excel row count and column order match the on-screen view
   exactly, with filters applied.
3. Attempt every write action from a FINANCE_REVIEWER session. All must fail.
4. Approve a payment and confirm it appears on Finance with no manual step.
5. Reject a payment and confirm it appears in no Finance total but is visible in
   history.
6. Confirm the GST summary base + GST equals the total collection to the paisa.
```

---

# PHASE 9 — Super Admin Console & Audit Trail UI

**Goal:** one nominated person can unblock any situation but can never quietly change a number.

### Prompt

```
PHASE 9 of the ProITbridge build. Read CLAUDE.md, then all of section 8 (FR-SA-01 to
FR-SA-20, FR-ADM-01 to FR-ADM-10, FR-AUD-01 to FR-AUD-05) and BR-23 to BR-26 of
docs/FRD_v1.2.pdf.

Build the Super Admin Console. The governing principle: the Super Admin can reverse a
decision but can NEVER directly edit a financial figure. Every path to correcting money
runs back through Sales and Nandhiya, and every override is reported to Rajesh.

## Complete visibility (FR-SA-01 to FR-SA-05)
- Read access to EVERY screen of the Sales, Data Management and Finance dashboards
  without switching accounts (FR-SA-01). Implement as a view-as mode that reuses the
  existing dashboard components in read-only mode — do not duplicate the screens.
- Consolidated system overview in one view: total leads and their stage distribution;
  payments pending audit and their ageing; approved collection for the period;
  outstanding balance; 15-day deadlines approaching; Operations handovers completed
  (FR-SA-02).
- Open any lead, enrollment or payment and see its complete history and every version
  of its proof (FR-SA-03).
- Workflow-health panel highlighting bottlenecks: records pending audit beyond the
  ageing threshold, salespeople with repeated correction-required outcomes, leads
  stalled at the same status beyond a configurable period, and failed notification
  deliveries (FR-SA-04).
- Run and export every report available to any other role, across all users and all
  periods (FR-SA-05).

## Controlled override authority (FR-SA-06 to FR-SA-15)
EVERY override below requires a mandatory written reason, writes an immutable
SuperAdminActivity entry, writes an AuditTrail entry, and notifies the affected role.
Build ONE `performOverride()` service that all of them route through, so this can never
be forgotten in one branch.

- Reverse or reopen an audit decision: an APPROVED record back to PENDING_AUDIT, or a
  REJECTED record back into the queue (FR-SA-06).
- On reversing an approved payment: IMMEDIATELY withdraw it from the Finance Dashboard
  and from all collection totals, and notify Rajesh, Nandhiya and the originating
  salesperson of the withdrawal and its reason (FR-SA-07).
- The Super Admin CANNOT directly edit a payment amount, payment date or Transaction ID
  on any record, approved or not. That capability must not exist in the codebase — no
  server action, no admin form, no script (FR-SA-08, BR-24). Correcting an approved
  payment is possible ONLY by reopening the audit decision so the record travels back
  through Sales and Nandhiya.
- Unlock a locked fee with a mandatory reason, after which the fee recalculates and the
  payment draft MUST be regenerated (FR-SA-09).
- Reassign a lead from one salesperson to another with a mandatory reason, notifying
  both parties (FR-SA-10).
- Approve an above-threshold concession where the Sales Manager is unavailable
  (FR-SA-11).
- Grant an extension to a 15-day Down Payment deadline, or reverse an automatic
  Operations transfer executed in error (FR-SA-12).
- Act as a temporary L1 auditor when Nandhiya is unavailable. Any payment audited this
  way is VISIBLY marked "Audited by Super Admin (delegated)" on every dashboard and in
  the audit history (FR-SA-13).
- The system must NOT permit the Super Admin to delete any lead, enrollment, payment,
  proof or audit entry. Records may only be deactivated or voided, with a reason, and
  remain visible in history (FR-SA-14, BR-26).
- Every override shows a confirmation dialog stating the EXACT consequence before it is
  committed — e.g. "This will withdraw ₹34,999 from Rajesh's approved collection for
  August 2026 and notify three people." (FR-SA-15)

## Accountability of the Super Admin (FR-SA-16 to FR-SA-20)
- A dedicated, separately viewable Super Admin Activity Log, in addition to the
  system-wide audit trail (FR-SA-16).
- That log is visible to RAJESH in read-only form, so the highest-privilege role stays
  reviewable by the business (FR-SA-17).
- Immediate notification to Rajesh whenever the Super Admin reverses an audit decision,
  unlocks a fee, approves an above-threshold concession, or performs a delegated audit
  (FR-SA-18).
- A monthly Super Admin Override Summary listing every override, its reason, the
  affected record and the outcome (FR-SA-19).
- The Super Admin cannot modify, disable or purge the audit trail, the Activity Log, or
  the notifications sent to Rajesh under FR-SA-18 (FR-SA-20). Enforce at database
  privilege level, not only in code.

## System-wide audit trail UI (FR-AUD-01 to FR-AUD-05, FR-ADM-10)
- A searchable audit log with filters by user, entity, action type and date range,
  exportable (FR-ADM-10, FR-AUD-04).
- Confirm every event in FRD section 8.3 writes an entry. Write a test that performs
  each of the 18 listed event types and asserts an audit row exists for it. This test
  is the completeness proof for FR-AUD-01.
- Audit entries retained for a minimum of 7 years; no purge job may delete them
  (FR-AUD-03, NFR-13).
- Every data export is logged with user, report, filters and record count (FR-AUD-05).

## System configuration console
Bring the Phase 3 Pricing Master, the Phase 5 draft template, reason codes, concession
thresholds, the 15-day window, the reminder schedule and the ageing threshold together
into one Settings area (FR-ADM-05 to FR-ADM-09). Every change is audited with previous
and new value.

## Deliverables
- Super Admin console: overview, view-as mode, workflow health, override actions,
  activity log, override summary, settings, audit log search.
- The single performOverride() service.
- Rajesh's read-only view of the Super Admin Activity Log on his own dashboard.
- The 18-event audit completeness test.
```

### Verify Phase 9

```
Verify Phase 9:
1. Grep the entire codebase for any code path that can write Payment.received_amount,
   payment_date or transaction_id, and prove none is reachable by a SUPER_ADMIN.
2. Reverse an approved payment. Confirm within the same test that: it left the Finance
   totals immediately, Rajesh/Nandhiya/the salesperson were all notified, a
   SuperAdminActivity row exists with the reason, and the record is back in the queue.
3. Attempt to save an override with an empty reason. Must be refused.
4. Attempt to UPDATE and DELETE a super_admin_activity row as the application DB user.
   Both must be refused by the database itself.
5. Perform a delegated audit and confirm the "Audited by Super Admin (delegated)" mark
   appears on the Sales, Data Management and Finance views and in the history.
6. Run the 18-event audit completeness test and show it passing with zero gaps.
7. Log in as Rajesh and confirm the Super Admin Activity Log is visible and read-only.
```

---

# PHASE 10 — Automation Engine (15-Day Rule, Notifications, Ops Handover)

**Goal:** the manual chasing disappears. Deadlines enforce themselves.

### Prompt

```
PHASE 10 of the ProITbridge build. Read CLAUDE.md, then sections 5.8, 5.9, 5.10
(FR-SAL-49 to FR-SAL-71) and BR-07 to BR-12 of docs/FRD_v1.2.pdf.

Build the automation engine: the 15-day payment rule, the notification system and the
Operations handover.

## Job infrastructure
Use a durable scheduled-job mechanism (BullMQ with Redis, or pg-boss on the existing
Postgres — prefer pg-boss to avoid adding Redis). Requirements:
- Jobs are idempotent. Running the same job twice on the same day must not send two
  reminders or perform two transfers. Enforce with a unique key per (job, entity, date).
- Every job run is logged with its outcome and any failures.
- A failed notification delivery surfaces on the Super Admin workflow-health panel
  (FR-SA-04).

## The 15-day rule (FR-SAL-49 to FR-SAL-57, BR-08 to BR-10)
This applies ONLY when the course has ALREADY STARTED (FRD 3.3.2). A lead whose course
has not started has NO time-bound restriction whatsoever (FR-SAL-55, BR-08) — get this
branch right, because applying the countdown to a not-started lead would generate false
alarms across the whole team.

- When a Course Starting Amount is recorded AND APPROVED, record the payment date and
  start a 15-day countdown for the Down Payment (FR-SAL-49). The clock starts on
  approval, not on submission.
- Show the pending payment, the days remaining and the exact deadline date prominently
  on the salesperson's dashboard (FR-SAL-50).
- Automated reminders on Day 3, Day 7, Day 10, Day 13 and Day 14 to the salesperson,
  and configurable reminders to the learner (FR-SAL-51). Read the schedule from
  SystemConfig (FR-SAL-56).
- A "deadline approaching" alert to the salesperson AND the Sales Manager on Day 13
  (FR-SAL-52).
- If the Down Payment is not received by the end of Day 15: automatically transfer the
  lead to the Operations Team, change the lead status accordingly, and notify the
  salesperson, the Sales Manager, Nandhiya and Rajesh (FR-SAL-53, BR-10).
- Where only two payments are received in total, automatically treat Payment 2 as the
  Final Payment and close the payment cycle when the balance reaches zero (FR-SAL-54,
  BR-07).
- The Sales Manager may grant a documented extension to the deadline, with a reason,
  recorded in the audit trail (FR-SAL-57). The Super Admin may also grant one and may
  reverse an automatic transfer executed in error (FR-SA-12).
- Timezone: all deadline arithmetic in IST. "End of Day 15" means 23:59:59 IST on the
  fifteenth day. Write explicit tests for the boundary, and for a payment approved at
  23:55 on Day 15.

## Notification engine (FR-SAL-58 to FR-SAL-66)
Create src/server/notifications/ with a NotificationProvider interface and two
implementations: a DevProvider that writes to the Notification table and logs, and an
EmailProvider shaped for SendGrid/SES with the API call marked TODO-INTEGRATION for
Phase 12. Channels: IN_APP and EMAIL. WhatsApp stays behind a feature flag pending
decision Q-01.

Triggers to implement, exactly as FRD 5.9 specifies:
- FR-SAL-58: basic details incomplete 24h after the lead was marked Interested ->
  salesperson
- FR-SAL-59: payment draft generated but no payment recorded after 48h -> salesperson
- FR-SAL-60: Down Payment outstanding -> salesperson
- FR-SAL-61: Day 13 of the 15-day window -> salesperson + Sales Manager
- FR-SAL-62: end of Day 15, Down Payment not received -> salesperson, Manager,
  Nandhiya, Rajesh, Operations
- FR-SAL-63: balance reaches zero -> salesperson, Manager, Nandhiya, Rajesh
- FR-SAL-64: Nandhiya returns a record as Correction Required -> originating
  salesperson, with the reason in the message
- FR-SAL-65: Nandhiya rejects a record -> originating salesperson + Sales Manager,
  with the reason
- FR-SAL-66: a manual follow-up task falls due -> salesperson
Plus, from earlier phases: Super Admin override notifications to Rajesh (FR-SA-18),
account lockout alerts (FR-AUTH-07), Super Admin login alerts (NFR-07a), and daily /
monthly Finance digests (FR-FIN-07, FR-FIN-26).

Build an in-app notification centre with unread counts and mark-as-read, plus a
per-user preference screen for which notifications arrive by email.

## Follow-up tasks (FR-SAL-66)
Salespeople can create manual follow-up tasks against a lead with a due date and
description; due tasks appear in "My Pending Actions" and trigger a notification.

## Operations handover (FR-SAL-67 to FR-SAL-71, BR-12)
- Assemble ONE consolidated learner/payment record — never fragments (BR-12) —
  containing: Learner details (Full Name, DOB, Address, Email, Mobile); Course details
  (Program, Plan, Commencing Date, batch); Pricing (Standard Fee, Concession, Final
  Approved Fee); Payment details (Payments 1/2/3, Total Received, Balance, Transaction
  IDs, Screenshots); Sales details (Salesperson, Lead Source, Enrollment Date, Remarks)
  (FR-SAL-67).
- BEFORE handover, validate that basic details, course, plan, fee, commencing date,
  payment information, Transaction ID and payment screenshot are ALL complete
  (FR-SAL-68).
- If anything is missing, list EXACTLY which fields are incomplete and BLOCK the
  handover (FR-SAL-69).
- When complete, display exactly: "Handover Successfully Sent." (FR-SAL-70)
- The consolidated record is simultaneously available to Nandhiya and Rajesh, and
  exports to PDF (FR-SAL-71).
- Two handover types: MANUAL (triggered by the salesperson when fully paid) and
  AUTO_DAY15 (triggered by the 15-day rule). Both use the same validation and the same
  record shape.

## Deliverables
- pg-boss (or equivalent) job runner with idempotency keys and a job log.
- The five reminder jobs, the Day-13 alert job, the Day-15 transfer job, and the
  ageing-escalation job for Nandhiya's queue.
- Notification engine with in-app centre and preferences.
- Handover builder, validator, viewer and PDF export.
- Tests: the countdown does not start for a not-started course; the boundary at
  23:59:59 IST; a job run twice sends one reminder; a blocked handover lists the exact
  missing fields; the Day-15 transfer notifies all five parties.
```

### Verify Phase 10

```
Verify Phase 10 with time travel — seed data at controlled dates rather than waiting:
1. Course NOT started: confirm no countdown, no reminders, no transfer, ever.
2. Course started: confirm reminders fire on exactly days 3, 7, 10, 13, 14 and not on
   other days.
3. Down Payment approved at 23:55 IST on Day 15: confirm NO transfer happens.
   Approved at 00:05 on Day 16: confirm the transfer DID happen at end of Day 15.
4. Run the daily job twice for the same date and confirm exactly one notification per
   trigger exists.
5. Change reminder_days in SystemConfig to [5,10] and confirm the schedule changes with
   no code change.
6. Attempt a handover on an enrollment missing a Transaction ID and confirm the error
   names that exact field.
```

---

# PHASE 11 — Payment Integrity & Reconciliation

**Goal:** the month tallies without anyone chasing the sales team. A mismatch is impossible to create silently.

### Prompt

```
PHASE 11 of the ProITbridge build. Read CLAUDE.md, then all of section 13 (FR-REC-01
to FR-REC-18) and BR-27 to BR-30 of docs/FRD_v1.2.pdf.

Build the payment integrity and reconciliation layer. Several FR-REC controls were
implemented in earlier phases — in this phase you AUDIT that they are actually in place,
then build the detection layer on top.

## Part A — Verify the prevention controls already built
Go through FR-REC-01 to FR-REC-10 one by one. For each, locate the implementation,
write a test that proves it, and record the file:line in docs/RECONCILIATION.md:
- FR-REC-01 unique Transaction ID at DATABASE level, duplicate blocked at submission
  naming the lead and payment that already holds it
- FR-REC-02 Nandhiya cannot approve without explicitly confirming amount, date and
  Transaction ID against the proof, each recorded in history
- FR-REC-03 a variance between received and expected blocks approval until corrected or
  explicitly accepted with a written reason
- FR-REC-04 any payment that would take total approved received above the Final Approved
  Fee is blocked; over-collection requires an explicit Super Admin override with reason
- FR-REC-05 probable duplicate detection — same lead, same amount, same date within the
  configurable window — warning at submission AND again at approval
- FR-REC-06 balance and every total computed server-side from stored approved records; a
  total is never accepted from the browser and never stored as a standalone figure
- FR-REC-07 exact decimal arithmetic everywhere; NO floating point for money anywhere in
  the system. Prove this by grepping for `parseFloat`, `Number(`, `toFixed` and `*`/`+`
  on money values outside src/server/money, and fixing every hit.
- FR-REC-08 one documented rounding rule applied consistently across GST, the payment
  draft, every dashboard and every export
- FR-REC-09 a payment is immutable once approved; change only via reopening the audit
  decision
- FR-REC-10 no payment, proof or audit entry is ever deleted; an error is VOIDED with a
  mandatory reason, excluded from all totals, and permanently visible in history
If any control is missing or weak, fix it in this phase.

## Part B — Build the detection layer (FR-REC-11 to FR-REC-18)

Daily reconciliation job (FR-REC-11):
For EVERY active enrollment, verify that
  sum(approved, non-voided payments) + outstanding_balance == final_approved_fee
Run it nightly and make it runnable on demand from the Super Admin console.

Exception raising (FR-REC-12, BR-30):
Any enrollment that fails the check is raised as an exception to the Super Admin AND to
Rajesh, naming the record and the exact nature of the discrepancy. Exceptions have their
own screen with open/acknowledged/resolved states and a resolution note.

Finance total verification (FR-REC-13):
Independently verify that the collection total shown on the Finance Dashboard for any
period equals the sum of the individual approved payment records in that period, and
flag any variance. Implement this as a second, independently written query — not a reuse
of the dashboard query — so it can actually catch a bug in the dashboard query.

Orphan detection (FR-REC-14):
Detect and report: a payment without a proof; a proof not linked to a payment; an
approved payment with no audit entry; a payment whose lead has been voided.

Month-end reconciliation statement (FR-REC-15):
Opening outstanding, payments approved in the period by type, voids and reversals, and
closing outstanding — with every figure reconciling to the individual records behind it,
and each line drillable to those records.

Balance-change traceability (FR-REC-16):
Every change to a balance generates an audit entry recording what caused it, so any
figure on any dashboard traces back to the specific payments that produced it. Build a
"trace this number" view: click any total anywhere and see the exact payment rows behind
it.

Monthly exceptions report to Rajesh (FR-REC-17):
All payments approved outside normal working hours; all Super Admin overrides affecting
money; all voided payments — in one monthly report.

No silent auto-adjustment (FR-REC-18):
The system NEVER silently adjusts a monetary figure. Every correction is an explicit,
attributed, reasoned action by a named user. Add a test that asserts no service function
writes a money field without an actor and a reason where a reason is required.

## Deliverables
- docs/RECONCILIATION.md mapping all 18 FR-REC controls to their implementation and test.
- Daily reconciliation job + exceptions screen.
- Month-end reconciliation statement with drill-down.
- Trace-this-number view.
- Monthly exceptions report.
```

### Verify Phase 11

```
Verify Phase 11 by deliberately breaking things via direct SQL, then confirming the
system catches it:
1. UPDATE a payment's received_amount directly in the database. Run the daily
   reconciliation and confirm the enrollment is raised as an exception to both the
   Super Admin and Rajesh, naming the discrepancy.
2. Insert a payment row with no proof. Confirm the orphan report catches it.
3. Generate a month-end statement for seeded data and reconcile it by hand against a
   raw SQL sum. They must match to the paisa.
4. Grep the whole codebase for floating-point arithmetic on money and show zero hits
   outside src/server/money.
5. Click a total on the Finance dashboard and confirm the trace view lists exactly the
   payment rows that sum to it.
```

---

# PHASE 12 — Hardening, Testing, UAT & Deployment

**Goal:** pass all 12 Phase-1 acceptance criteria in FRD §15.1 and go live safely.

### Prompt

```
PHASE 12, the final phase of the ProITbridge build. Read CLAUDE.md, then section 11
(NFR-01 to NFR-16), sections 12.4, 12.5, 12.6 (FR-SEC-27 to FR-SEC-46) and section 15.1
(the Phase 1 acceptance criteria) of docs/FRD_v1.2.pdf.

Harden, test and prepare the system for go-live.

## 1. Wire the real external providers
Replace the stubs behind the interfaces built in earlier phases. Change ONLY the provider
implementations — no business logic should need to move:
- OCR: Google Cloud Vision (or AWS Textract / Azure Document Intelligence). Keys from
  env only (FR-SEC-12). Handle quota errors and timeouts by falling back to manual entry
  (FR-SAL-47, NFR-02).
- Email: SendGrid or Amazon SES, with SPF/DKIM configured on the sending domain (D-04).
  Handle bounces and surface failed deliveries to the Super Admin panel.
- Virus scanning on upload: ClamAV or a managed scanning service (FR-SEC-23).
- Object storage: real S3-compatible bucket, private ACL, signed URLs only (FR-SEC-20,
  FR-SEC-21).

## 2. Application security (FR-SEC-27 to FR-SEC-33)
- Work through the OWASP Top 10 against this codebase: injection, broken access control,
  cryptographic failures, security misconfiguration, vulnerable dependencies. Document
  each with what was checked and the result (FR-SEC-27).
- Confirm all input is validated and sanitised server-side (FR-SEC-28).
- Confirm XSS and CSRF protection on every state-changing operation (FR-SEC-29).
- Confirm no error message exposes a stack trace, database structure, file path, query
  or internal identifier (FR-SEC-30).
- Confirm personal data, payment amounts, Transaction IDs and auth tokens appear in no
  URL, browser history, referrer header or application log (FR-SEC-31). Actually grep the
  log output of a full end-to-end run to prove this.
- Version-pin every dependency and add a vulnerability scan to CI (FR-SEC-32).
- Produce a security review pack for the independent penetration test required before
  go-live (FR-SEC-33): architecture note, role matrix, data-flow diagram, endpoint
  inventory and test credentials.

## 2b. Database and infrastructure security (FR-SEC-10 to FR-SEC-18)
Phase 1 built FR-SEC-11, 13 and 19 into the schema. Close the rest now:
- The database is NEVER reachable from the public internet — connections only from the
  application server, over a private network or a firewall-restricted path (FR-SEC-10).
- Encryption at rest with AES-256 or equivalent, covering database files, backups AND
  uploaded payment proofs (FR-SEC-14).
- TLS 1.2+ on all data in transit, including the application-to-database connection
  where the two are not on the same private host (FR-SEC-15).
- Field-level encryption or tokenisation for personal identifiers — mobile, email,
  address — and Transaction IDs, where the deployment requires it (FR-SEC-16). Decide
  this with Rajesh, implement it if yes, and record the decision either way.
- No developer or third party holds standing production database access. Any production
  access is time-limited, individually attributed, approved by the Super Admin and
  logged (FR-SEC-17). Document the procedure in the runbook.
- Test and development environments NEVER use real learner data. Write an anonymisation
  script for any production data copied downward (FR-SEC-18).

## 3. Backup, recovery and continuity (FR-SEC-34 to FR-SEC-39)
- Automated encrypted database backup at least every 24 hours, stored separately from
  the primary system (FR-SEC-34).
- Payment PROOFS are included in the backup regime — a database backup alone is NOT a
  complete backup of this system (FR-SEC-35).
- Retention: 30 days of daily backups, plus a monthly backup retained 12 months
  (FR-SEC-36).
- Write and TEST a full restore procedure, and document the test (FR-SEC-37). Actually
  perform a restore into a scratch database and prove the system runs against it.
- Target RPO 24 hours, RTO 8 working hours (FR-SEC-38).
- Produce docs/RUNBOOK.md assigning a NAMED OWNER to backup execution, off-site copy,
  OS patching, firewall management and physical access control — mandatory if hosting on
  a ProITbridge-owned server (FR-SEC-39, Q-11, Q-12).

## 4. Monitoring, privacy and retention (FR-SEC-40 to FR-SEC-46)
- Security event log covering logins, failed logins, lockouts, password and role changes,
  permission-denied events, proof access and data exports (FR-SEC-40).
- Alert the Super Admin on: repeated failed logins, a login from an unrecognised location,
  a bulk export of learner data, or any use of the break-glass credential (FR-SEC-41).
- Log every export with user, report, filters and record count (FR-SEC-42).
- Data-protection note: learner personal data is used only for enrollment and payment
  administration and is not shared outside ProITbridge without a documented business
  reason (FR-SEC-43).
- Each role sees only the personal data its function requires (FR-SEC-44).
- Financial and audit records retained a minimum of 7 years; a closed learner record is
  ARCHIVED, never deleted (FR-SEC-45, NFR-13).
- docs/PRIVILEGED_ACCESS.md recording who holds each privileged credential at go-live,
  reviewed whenever a team member joins or leaves (FR-SEC-46).

## 5. Non-functional verification (NFR-01 to NFR-16)
Seed 10,000 leads and 50,000 payment records, then MEASURE — do not assume:
- NFR-01: every dashboard and list view loads within 3 seconds at that volume. Fix the
  queries and add the indexes needed to hit it.
- NFR-02: OCR completes within 10 seconds or the user continues manually.
- NFR-03: 25 concurrent users and 50,000 payment records without redesign. Run a load
  test at that volume.
- NFR-04: 99.5% uptime target during business hours 09:00-21:00 IST — set up uptime
  monitoring and alerting against it.
- NFR-09: automated daily backup with 30-day retention and a documented, TESTED restore
  procedure (cross-check against FR-SEC-34 to FR-SEC-37 above).
- NFR-11: every error message states what is wrong and what the user should do next.
  Walk every error path in the app and fix any generic message.
- NFR-10: every screen is usable on a phone browser. Test the payment capture flow and
  the audit queue on a 390px viewport specifically — salespeople work from phones.
- NFR-12: current and previous major Chrome, Edge and Safari.
- NFR-14: INR with Indian digit grouping, DD-MMM-YYYY dates, IST times everywhere.
- NFR-16: confirm NO business parameter is hard-coded. Grep for numeric literals like
  15, 18, 24999, 48 outside seed and test files and eliminate every one.

## 6. Test suite completion
- Unit tests for every service, especially the fee engine and the money module.
- Integration tests for the complete Sales -> Nandhiya -> Rajesh chain.
- Playwright end-to-end tests for all 12 acceptance criteria in FRD 15.1, one test per
  criterion, named after it.
- A test that walks all 30 business rules BR-01 to BR-30 and asserts each one, named for
  the rule. This is the UAT evidence pack.
- CI pipeline running lint, typecheck, unit, integration, e2e and dependency scan.

## 7. Deployment
- Dockerfile and docker-compose.prod.yml.
- Database migration strategy with rollback.
- Health-check endpoint and structured logging with a request id (never logging personal
  data or amounts).
- docs/DEPLOYMENT.md covering both hosting options from Q-11 — managed cloud in an India
  region, and a ProITbridge-owned server — with the security obligations that differ
  between them, plus TLS 1.2+ termination and the database on a private network never
  reachable from the public internet (FR-SEC-10, FR-SEC-15, NFR-05).
- A go-live checklist: seed the real Pricing Master (D-01), confirm the payment-draft
  wording and bank details (D-02), create the eight real user accounts, nominate the
  Sales Manager and Super Admin (Q-03, D-06), document the break-glass procedure,
  complete the penetration test (D-09), test the restore, and decide the historical-data
  migration (Q-08).

## 8. Final acceptance run
Execute all 12 criteria from FRD 15.1 as a single scripted run and produce
docs/UAT_EVIDENCE.md with the result of each, plus the 30 business-rule test results.
Report honestly — list anything that does not pass rather than declaring success.
```

### Verify Phase 12

```
Produce a final go-live readiness report covering:
1. All 12 FRD 15.1 acceptance criteria — pass/fail with evidence.
2. All 30 business rules BR-01 to BR-30 — pass/fail with the test name.
3. Every FR-SEC requirement 01-46 — implemented / partially / not, with a file reference.
4. Every NFR 01-16 — measured value against the target.
5. Every requirement ID in the FRD that is NOT implemented, with the reason.
6. The open points from FRD section 17 that are still unanswered and what they block.
Be blunt about gaps. A report that claims everything passes is not useful to me.
```

---

## Appendix A — Requirement-to-phase index

| Requirement group | Count | Phase |
|---|---|---|
| FR-AUTH-01 to 11 | 11 | 2 |
| FR-SAL-01 to 13 | 13 | 4 |
| FR-SAL-14 to 31 | 18 | 3 + 4 |
| FR-SAL-32 to 37 | 6 | 5 |
| FR-SAL-38 to 48 | 11 | 6 |
| FR-SAL-49 to 71 | 23 | 10 |
| FR-DM-01 to 45 | 45 | 7 |
| FR-FIN-01 to 26 | 26 | 8 |
| FR-SA-01 to 20 | 20 | 9 |
| FR-ADM-01 to 10 | 10 | 3 + 9 |
| FR-AUD-01 to 05 | 5 | 1 + 9 |
| FR-SEC-01 to 09 | 9 | 2 |
| FR-SEC-10 to 19 | 10 | 1 + 12 |
| FR-SEC-20 to 26 | 7 | 6 |
| FR-SEC-27 to 46 | 20 | 12 |
| FR-REC-01 to 10 | 10 | 6 + 7 + 11 |
| FR-REC-11 to 18 | 8 | 11 |
| BR-01 to 30 | 30 | across all, verified in 12 |
| NFR-01 to 16 | 16 | 12 |

## Appendix B — Session hygiene for Claude Code

- **One phase per session.** Run `/clear` between phases. A 200k-token context makes Claude Code slower and more likely to forget an earlier rule.
- **Keep `CLAUDE.md` short and sharp.** It is loaded into every session. If it grows past ~300 lines, move detail into `docs/` and reference it.
- **Ask for the plan first on big phases.** For Phases 7 and 9, start with: *"Before writing code, give me your implementation plan for this phase and the files you will create. Wait for my approval."*
- **Make Claude Code prove things, never assert them.** Every Verify block above asks for a command and its output for exactly this reason.
- **Commit at every phase boundary** so you can roll back a phase that goes sideways.
- **When a phase gets stuck,** paste the specific FR-ID and its exact text from the FRD rather than re-explaining in your own words.

## Appendix C — What this pack deliberately does not build

Per FRD §1.4.2, these are out of Phase 1 scope and no prompt above touches them: payment gateway integration, automated bank reconciliation, GST filing or Tally/Zoho integration, an LMS, post-enrollment Operations workflows, refunds and cancellations (recommended for a later phase per Q-06), and native mobile apps.
