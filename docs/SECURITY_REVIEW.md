# Security Review Pack (Phase 12, FR-SEC-27, FR-SEC-33)

The independent penetration test required before go-live (D-09) is an **external**
activity that has NOT been performed — it must be booked and its findings closed
(acceptance criterion #15). This document is the pack the testers receive, plus the
in-house OWASP Top 10 review.

## 1. Architecture note

Next.js 15 (App Router, TS strict) · PostgreSQL 16 + Prisma · private object store for
payment proofs. Three-stage workflow: Salesperson captures → Nandhiya (L1 audit) approves
→ Rajesh (Finance) reads. One Super Admin above all three. Deny-by-default on every
request: **authenticate → authorise → validate**. Business logic lives in
`src/server/services`; edges are thin. Money is always `Prisma.Decimal`; totals are always
recomputed, never stored.

## 2. Role matrix

The FRD §2.2 RBAC matrix is encoded as data in `src/server/auth/permissions.ts` and walked
cell-by-cell by `tests/unit/permissions.test.ts` (130 cases). Five roles: SALESPERSON,
SALES_MANAGER, DATA_MGMT_AUDITOR, FINANCE_REVIEWER, SUPER_ADMIN. Finance holds no
payment-write permission of any kind (BR-18); no role holds `payment:edit-amount` — it does
not exist (FR-SA-08).

## 3. Data-flow (payment)

`Salesperson → upload proof (validate type → virus scan → private store, system key) →
OCR extract (human-confirm every field) → capturePayment (Zod → RBAC → unique Txn ID at DB)
→ PENDING_AUDIT → Nandhiya assertPaymentApprovable (proof + 3 confirmations + variance +
over-collection gates) → APPROVED (immutable; DB trigger) → financeVisiblePaymentWhere() →
Rajesh read-only.` Proof bytes are served only via a short-lived signed URL after RBAC +
record-access re-checks (`/api/proofs/[proofId]`).

## 4. Endpoint inventory

Route handlers (`src/app/api`): `health`, `proofs/[proofId]`, `finance/export`,
`audit/export`, `admin/audit/export`, `audit/[paymentId]/timeline`, `leads/[id]/draft`,
`handover/[id]/pdf`, `jobs/tick`. Each re-verifies session + permission server-side.
State-changing operations are **next-safe-action** server actions (deny-by-default via
`authActionClient`/`withPermission`), not open endpoints — same-origin + SameSite=Lax
cookies give CSRF protection (FR-SEC-29). Full list: `grep -rl "use server" src/app`.

## 5. Test credentials (seed; non-production only)

`mathiew|kevin|dinesh|hari@proitbridge.local` (SALESPERSON), `nandhiya@` (DATA_MGMT),
`rajesh@` (FINANCE), `sales.manager@`, `super.admin@`. Seed password `ChangeMe#123`
(`must_change_password` forced). These are for a scratch environment ONLY — real accounts
are created at go-live (never with these passwords).

---

## OWASP Top 10 (2021) review

| # | Category | What was checked | Result |
|---|---|---|---|
| A01 | Broken access control | Server-side RBAC on every request (middleware + layout guards + action guards + record-ownership); `payment:edit-amount` does not exist; Finance read-only. Tests: `permissions.test.ts`, `authz.actions.test.ts`, `phase9.verify`. | **Pass** — UI is never the control. |
| A02 | Cryptographic failures | Passwords bcrypt-hashed; sessions signed (jose) + DB-backed; proof URLs HMAC-signed, short-lived; secrets from env only. At-rest encryption is an infra control (FR-SEC-14, see DEPLOYMENT). | **Pass (app)**, infra to confirm at deploy. |
| A03 | Injection | Prisma parameterised everywhere; no string-concatenated SQL (FR-SEC-13); Zod validates every input at the boundary. `$queryRaw` used only with tagged-template params. | **Pass.** |
| A04 | Insecure design | Immutable audit trail; approved-payment immutability trigger; single override funnel; reconciliation detection layer. | **Pass.** |
| A05 | Security misconfiguration | CSP + HSTS + X-Frame-Options DENY + nosniff + Referrer-Policy no-referrer (`next.config.ts`); `poweredByHeader:false`; DB app role least-privilege. CSP still allows `'unsafe-inline'` styles — tighten with nonces post-go-live (tracked). | **Pass with one hardening item.** |
| A06 | Vulnerable components | Versions pinned; `pnpm audit` wired into CI (FR-SEC-32). Advisory until the lockfile is triaged at go-live. | **Partial** — make CI audit blocking at go-live. |
| A07 | Auth failures | Lockout after N failed logins, 2FA (OTP), forced first-login password change, session revocation on password/role change/deactivation, generic error messages (anti-enumeration). | **Pass.** |
| A08 | Integrity failures | `pnpm-lock.yaml` frozen in CI; Prisma migrations are the only schema path; audit tables append-only at the DB level. | **Pass.** |
| A09 | Logging & monitoring | `security_event` covers logins/lockouts/password+role changes/proof access/exports (FR-SEC-40); exports logged with filters+count (FR-SEC-42); no PII/amounts/tokens in logs (`log-privacy.test.ts`, FR-SEC-31). Alerting rules (FR-SEC-41) to be wired to the monitor at deploy. | **Pass (app)**, alert wiring at deploy. |
| A10 | SSRF | No user-controlled outbound URLs. OCR/email endpoints are fixed provider hosts from env config. | **Pass.** |

### Open hardening items (non-blocking, tracked for go-live)
1. Tighten CSP with per-request nonces (remove `'unsafe-inline'` on styles).
2. Make the CI `pnpm audit` step blocking once the lockfile advisories are triaged.
3. Wire FR-SEC-41 alerts (repeated failed logins, unrecognised-location login, bulk export,
   break-glass use) to the production monitor/pager.
4. Complete the external penetration test (D-09) and close findings.
