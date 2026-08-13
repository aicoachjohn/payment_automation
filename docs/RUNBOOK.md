# Operations Runbook (Phase 12, FR-SEC-39)

Assigns a **named owner** to every security-operations responsibility. Mandatory when
hosting on a ProITbridge-owned server; still required (with the provider's shared-
responsibility split noted) on managed cloud. Names are placeholders to be filled at
go-live — a role must never be left unassigned.

## Named owners (FR-SEC-39, D-08)

| Responsibility | Owner (name) | Backup | Cadence |
|---|---|---|---|
| Backup execution & verification | `TODO-BUSINESS` | `TODO-BUSINESS` | Daily automated; weekly manual verify |
| Off-site / cross-region backup copy | `TODO-BUSINESS` | — | Daily |
| OS / dependency patching | `TODO-BUSINESS` | — | Monthly + on critical CVE |
| Firewall / network management | `TODO-BUSINESS` | — | On change |
| Physical access control (self-host only) | `TODO-BUSINESS` | — | On change |
| Privileged-credential custody & access review | Super Admin | Break-glass holder | Quarterly + on joiner/leaver |
| Restore drill | `TODO-BUSINESS` | — | Quarterly (see below) |

## Backups (FR-SEC-34..38, NFR-09)

- **Schedule:** encrypted DB backup every 24h (RPO target 24h). Payment proofs are
  included — a DB-only backup is NOT complete (FR-SEC-35).
- **Retention:** 30 daily backups + 1 monthly backup kept for 12 months (FR-SEC-36).
- **Off-site:** at least one copy stored separately from the primary system.
- **Restore drill:** `scripts/restore-test.sh` restores DB + proofs into a scratch
  database and verifies the schema is queryable. Run quarterly; each run appends to
  `docs/RESTORE_TEST_LOG.md` (FR-SEC-37). **RTO target: 8 working hours** (FR-SEC-38).

## Production database access (FR-SEC-17)

No developer or third party holds **standing** production DB access. Any access is:
1. requested with a reason, 2. approved by the Super Admin, 3. time-limited (auto-expiring
credential or a short-lived role grant), 4. individually attributed, 5. logged. Record
each grant in `docs/PRIVILEGED_ACCESS.md`.

## Nightly automation

`POST /api/jobs/tick` (from the compose `cron` service or a platform scheduler, with
`x-cron-secret`) runs the 15-day rule, reminders, deadline transfers and the daily
reconciliation. Idempotent — a double run sends nothing twice. Check the last run at
`/admin/jobs`; a FAILED row there needs investigation.

## Incident response

- **DB down:** `/api/health` returns 503; failover / restore from the latest backup;
  communicate RTO.
- **Failed email deliveries:** surface as `Notification.status = FAILED` and on the
  Super Admin workflow-health panel; check `EMAIL_API_KEY` / SPF-DKIM / provider status.
- **Reconciliation exception raised:** `/admin/reconciliation` — investigate, acknowledge,
  resolve with a note. Rajesh is notified in parallel (FR-REC-12).
- **Break-glass login used:** the primary Super Admin and Rajesh are alerted (NFR-07a);
  review the `super_admin_activity` + `security_event` log immediately.

## Non-production data (FR-SEC-18)

Test/dev NEVER use real learner data. Any production copy pulled downward is scrubbed with
`scripts/anonymise.ts` (guarded by `ALLOW_ANONYMISE=yes`) before a developer touches it.
