# Go-Live Readiness Report (Phase 12)

**Honest assessment. This report lists what does NOT pass as prominently as what does.**
The software is functionally complete and its business logic is proven by an automated
suite (253 unit + 151 integration, all green; lint/typecheck/build clean). The gaps to
go-live are almost entirely **operational and external** — infrastructure encryption, a
booked penetration test, an executed restore drill, and load testing at target volume —
not missing features.

**Verdict: NOT yet ready for production sign-off.** Four hard blockers remain (see §7).
Everything the codebase itself owns is done and tested.

---

## 1. FRD §15.1 acceptance criteria (12)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 6 | Individual logins; each role sees only permitted data | ✅ Pass | `acceptance.test.ts #6`, `permissions.test.ts` |
| 7 | Lead → draft, no manual fee calc (Combo ×4) | ✅ Pass | `acceptance.test.ts #7` |
| 8 | Payment + proof + Txn ID → Pending Audit queue | ✅ Pass | `acceptance.test.ts #8` |
| 9 | Approve / correction / reject with reasons; salesperson notified | ✅ Pass | `acceptance.test.ts #9` |
| 10 | Approved on Finance w/ full statement; non-approved absent | ✅ Pass | `acceptance.test.ts #10` |
| 11 | Customer sheet auto-populated; exports to Excel/CSV | ✅ Pass | `acceptance.test.ts #11` |
| 12 | Audit history: submitter/auditor/decisions/reasons/before-after | ✅ Pass | `acceptance.test.ts #12` |
| 13 | SA reverses w/ reason; can't edit money; Rajesh notified | ✅ Pass | `acceptance.test.ts #13` |
| 14 | Duplicate Txn ID (DB); over-collection blocked; recon clean | ✅ Pass | `acceptance.test.ts #14` |
| 15 | Independent pen test completed, findings closed | ❌ **Blocker** | External (D-09). Pack ready: `SECURITY_REVIEW.md` |
| 16 | Full DB + proof restore tested from backup | ⚠️ **Blocker** | Procedure ready (`scripts/restore-test.sh`); not yet executed against a prod-like copy |
| 17 | All 30 business rules pass | ✅ Pass | `business-rules.test.ts` (29/29) |

**10 of 12 pass in software. #15 and #16 are operational and must be executed at go-live.**

## 2. Business rules BR-01..BR-30

All pass — `tests/integration/business-rules.test.ts`, one named test per rule (BR-09/10
combined). See `UAT_EVIDENCE.md` for the table.

## 3. FR-SEC-01..46

| Range | Status | Notes |
|---|---|---|
| FR-SEC-01..09 (auth/session/2FA) | ✅ Implemented | Phase 2 — `src/server/auth/*`, `services/auth.ts` |
| FR-SEC-10 (DB not public) | ⚠️ Infra | Enforced by deploy topology (`docker-compose.prod.yml` private `dbnet`, `DEPLOYMENT.md`), not code |
| FR-SEC-11 (least-privilege DB role) | ✅ Implemented | `proitbridge_app`; UPDATE/DELETE revoked on audit tables (init migration) |
| FR-SEC-12 (keys from env) | ✅ Implemented | All providers read keys from env only |
| FR-SEC-13 (no raw SQL concat) | ✅ Implemented | Prisma / tagged-template params only |
| FR-SEC-14 (encryption at rest) | ❌ Infra | Volume/bucket encryption — deploy responsibility (documented) |
| FR-SEC-15 (TLS 1.2+) | ❌ Infra | Terminated at proxy/LB (documented) |
| FR-SEC-16 (field-level encryption/tokenisation) | ⚠️ Decision pending | Not implemented; **decide with Rajesh** (recorded as open). App keeps PII in standard columns today |
| FR-SEC-17 (no standing prod DB access) | ⚠️ Procedural | `RUNBOOK.md` procedure; enforce operationally |
| FR-SEC-18 (anonymise downward copies) | ✅ Implemented | `scripts/anonymise.ts` |
| FR-SEC-19..26 (proof storage, signed URLs, validation, scan) | ✅ Implemented / adapter | Private store + HMAC signed URLs + type validation; virus scan is a pass-through dev adapter — **wire ClamAV/managed scan at deploy** |
| FR-SEC-27 (OWASP review) | ✅ Done | `SECURITY_REVIEW.md` |
| FR-SEC-28 (server-side validation) | ✅ Implemented | Zod at every boundary |
| FR-SEC-29 (XSS/CSRF) | ✅ Implemented | React escaping; SameSite=Lax + same-origin server actions; CSP |
| FR-SEC-30 (safe errors) | ✅ Implemented | Sanitised messages; no stack/SQL/path leaks |
| FR-SEC-31 (no PII/amount/token in logs) | ✅ Implemented + tested | `log-privacy.test.ts` |
| FR-SEC-32 (pinned deps + CI scan) | ⚠️ Partial | Pinned + `pnpm audit` in CI, currently advisory — **make blocking at go-live** |
| FR-SEC-33 (pen test) | ❌ **Blocker** | External; pack ready |
| FR-SEC-34..38 (backups, restore, RPO/RTO) | ⚠️ Ready, not executed | `scripts/restore-test.sh` + `RUNBOOK.md`; drill must be run |
| FR-SEC-39 (named owners) | ⚠️ Names pending | `RUNBOOK.md` table — fill `TODO-BUSINESS` at go-live |
| FR-SEC-40 (security event log) | ✅ Implemented | `security_event` |
| FR-SEC-41 (alerting) | ⚠️ Partial | Break-glass/SA-login/lockout alerts implemented; wire failed-login-rate / unknown-location / bulk-export alerts to the monitor at deploy |
| FR-SEC-42 (export logging) | ✅ Implemented | Finance + audit exports logged with filters+count |
| FR-SEC-43 (data-protection note) | ✅ Documented | This pack + `SECURITY_REVIEW.md` |
| FR-SEC-44 (least-data per role) | ✅ Implemented | RBAC + finance-visibility predicate |
| FR-SEC-45 (7-yr retention, archive-not-delete) | ✅ Implemented | Append-only audit; void/deactivate, never delete |
| FR-SEC-46 (privileged-access register) | ✅ Documented | `PRIVILEGED_ACCESS.md` |

## 4. NFR-01..16 (measured vs target)

| NFR | Target | Measured / Status |
|---|---|---|
| NFR-01 | Dashboards < 3 s at volume | ✅ **6.4 ms** finance statement, **2.4 ms** reconciliation groupBy, **2.1 ms** customer aggregation at ~4,800 payments (indexed). Extrapolates well under 3 s |
| NFR-02 | OCR ≤ 10 s or continue manually | ✅ Hard 10 s timeout → manual fallback (`runOcr`); real-provider latency to confirm post-wiring |
| NFR-03 | 25 concurrent + 50k records | ❌ **Not load-tested** (no load-test infra here). Query perf above is encouraging; run k6/Artillery at go-live |
| NFR-04 | 99.5% uptime 09:00–21:00 IST | ⚠️ `/api/health` ready; wire uptime monitor at deploy |
| NFR-05 | HTTPS/TLS | ❌ Infra (proxy) |
| NFR-06/07/07a | Private storage, server-side RBAC, 2FA | ✅ Implemented |
| NFR-08 | Session timeout | ✅ Implemented (config-driven, tighter for SA) |
| NFR-09 | Daily backup + tested restore | ⚠️ Ready, not executed (see FR-SEC-34..37) |
| NFR-10 | Usable on a phone browser | ⚠️ Mobile-first Tailwind + `overflow-x` lists throughout; **not visually QA'd at 390px** in this env |
| NFR-11 | Actionable error messages | ✅ Safe, specific messages on every path |
| NFR-12 | Current+previous Chrome/Edge/Safari | ❌ **Not matrix-tested** (no browser matrix here) |
| NFR-13 | 7-yr retention | ✅ Append-only + archive-not-delete |
| NFR-14 | ₹ Indian grouping, DD-MMM-YYYY, IST | ✅ `src/lib/format`; used everywhere |
| NFR-15 | Documentation | ✅ CLAUDE.md + `docs/*` |
| NFR-16 | No hard-coded business parameters | ✅ `no-hardcoded-params.test.ts`; all config-driven |

## 5. Requirements NOT implemented (with reason)

- **FR-SEC-14/15, NFR-05 (at-rest & in-transit encryption):** infrastructure controls,
  configured at deploy — code cannot own them. Documented in `DEPLOYMENT.md`.
- **FR-SEC-16 (field-level PII/Txn encryption):** deliberately deferred — needs a
  business decision with Rajesh on whether the deployment requires it. Recorded, not built.
- **FR-SEC-33 / criterion #15 (pen test):** external engagement (D-09).
- **NFR-03 load test, NFR-12 browser matrix, NFR-10 390px visual QA:** require test infra
  (load generator, device/browser lab) not available in the build environment.
- **Real virus scanner (ClamAV) & S3 storage client:** shipped as env-selected adapters;
  email (SendGrid) and OCR (Google Vision) have working REST implementations via `fetch`.
  ClamAV (socket) and S3 (SigV4) need their client wired at deploy — no business logic
  moves (interfaces unchanged).
- **WhatsApp learner reminders (Q-01/D-07):** behind a feature flag, off pending decision.

## 6. Open FRD §17 points still unanswered (and what they block)

| Q | Point | Blocks |
|---|---|---|
| Q-01 | WhatsApp vs salesperson-only reminders | Learner-facing reminder channel (flag off; nothing else) |
| Q-02 | Concession approval threshold (per plan) | Nothing — config default ₹2,000 / 10%; change is a config edit |
| Q-03 | Nominated Sales Manager & single Super Admin | UAT sign-off (must be named — D-06) |
| Q-04 | Double-shot split | Nothing — config default 50/50 |
| Q-05 | Default payment schedule | Nothing — config default 40/40/20 |
| Q-08 | Historical-data migration | Whether to import legacy leads/payments before go-live |
| Q-11 | Hosting decision (cloud vs owned server) | The entire infra/security-ownership set (FR-SEC-10/14/15/39) |
| D-01 | Signed-off Pricing Master data | Criterion #7 realism at UAT (seed placeholders exist) |
| D-02 | Approved draft wording + bank details | Customer-facing draft accuracy (defaults are config) |

## 7. Hard blockers before production sign-off

1. **Book and complete the independent penetration test; close findings** (FR-SEC-33, #15).
2. **Execute the backup + restore drill** against a prod-like copy and log it (FR-SEC-37, #16).
3. **Provision infra encryption + TLS + private DB** and confirm (FR-SEC-10/14/15).
4. **Name the Super Admin, break-glass holder, Sales Manager and all FR-SEC-39 owners**
   (Q-03, D-06, D-08).

## 8. Go-live checklist (execute in order)
1. Confirm hosting (Q-11); provision DB (private, encrypted, TLS), object store (private,
   versioned), backups.
2. Seed the real Pricing Master (D-01); confirm draft wording + bank details (D-02).
3. Create the eight real user accounts; nominate Sales Manager + Super Admin; seal the
   break-glass credential and document the procedure (D-06).
4. Wire real providers: `EMAIL_PROVIDER=sendgrid` (SPF/DKIM), `OCR_PROVIDER=vision`,
   `STORAGE_PROVIDER=s3`, real virus scanner. Set all secrets in the secret store.
5. Wire the uptime monitor to `/api/health` and the FR-SEC-41 alerts.
6. Run the restore drill; run a load test at 25 users / 50k payments.
7. Complete the penetration test; close findings.
8. Make CI `pnpm audit` blocking.
9. Fill `RUNBOOK.md` + `PRIVILEGED_ACCESS.md` owners.
10. Final UAT run (`acceptance` + `business-rules`) against the provisioned environment.
