# Deployment (Phase 12)

Covers both hosting options from FRD Q-11 and the security obligations that differ
between them. The application is a Next.js 15 standalone server + PostgreSQL 16 + a
private object store for payment proofs.

> **Deploying to Vercel instead?** See `VERCEL_DEPLOYMENT.md`. Serverless changes three
> things that matter here — proof storage cannot use the filesystem, the database needs a
> pooled connection, and the daily automation is driven by Vercel Cron.

## Build & run

```bash
pnpm build                       # Next standalone output (.next/standalone)
docker build -t proitbridge .    # production image (multi-stage, non-root, healthcheck)
docker compose -f docker-compose.prod.yml up -d
```

## Environment (secrets are injected at runtime only — FR-SEC-12; never baked into the image)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Restricted runtime role `proitbridge_app` (UPDATE/DELETE revoked on `audit_trail`, `super_admin_activity`). |
| `DIRECT_URL` | Owner role — migrations/DDL only. |
| `AUTH_SECRET` | Session cookie signing (jose). |
| `PROOF_SIGNING_SECRET` | Short-lived signed proof-URL tokens. |
| `STORAGE_PROVIDER` | `s3` in prod (private ACL, signed URLs) / `local` in dev. |
| _(no email vars)_ | Email was removed by business decision — notifications are in-app only. |
| `OCR_PROVIDER` + `OCR_API_KEY` | `vision` in prod; timeout → manual entry (FR-SAL-47). |
| `CRON_SECRET` | Auth for `POST /api/jobs/tick`. |
| `APP_VERSION` | Surfaced by `/api/health`. |

## Migration strategy (with rollback)

- Forward: `prisma migrate deploy` (idempotent; applies pending migrations only). Run it
  as `DIRECT_URL` during deploy, before the new app image takes traffic.
- Additive-first: new columns are nullable / defaulted so the previous app version keeps
  running during a rolling deploy (expand → migrate → contract).
- Rollback: keep the pre-deploy `pg_dump` (see `scripts/restore-test.sh`). A migration is
  reverted by restoring that dump into the DB and redeploying the previous image tag.
  Never hand-edit `_prisma_migrations`.

## Health, logging, monitoring

- `GET /api/health` → 200 `{status, db, uptimeMs, version}` or 503 if the DB is down. No
  PII/amounts. Point the uptime monitor here (NFR-04, business hours 09:00–21:00 IST).
- Structured JSON logs with a `requestId` (`src/server/log.ts`). Logs never contain
  amounts, Transaction IDs, tokens or PII (FR-SEC-31, proven by
  `tests/integration/log-privacy.test.ts`).

## The two hosting options (Q-11)

### A. Managed cloud in an India region (recommended)
- Managed Postgres with encryption at rest (AES-256, FR-SEC-14), automated backups
  (FR-SEC-34), TLS 1.2+ enforced (FR-SEC-15), and **no public IP** on the DB — reachable
  only from the app's private subnet/VPC (FR-SEC-10).
- App behind a load balancer terminating TLS 1.2+; bind the container to loopback and let
  the LB handle public ingress.
- Object storage: a private S3-compatible bucket, ACL private, server-side encryption on,
  access via signed URLs only (FR-SEC-20/21). Enable bucket versioning + backup
  (FR-SEC-35).
- Security ownership largely shared with the provider; still assign the FR-SEC-39 owners
  (see `RUNBOOK.md`).

### B. ProITbridge-owned server
- ALL of FR-SEC-39 is on ProITbridge: backup execution, off-site copy, OS patching,
  firewall management, physical access control — each with a **named owner** in
  `RUNBOOK.md` (mandatory for self-hosting).
- Postgres bound to `127.0.0.1` / a private interface only; firewall denies inbound to
  5432 from anywhere but the app host (FR-SEC-10).
- Full-disk encryption for the DB volume, backups and the proof store (FR-SEC-14). A
  reverse proxy (nginx/Caddy) terminates TLS 1.2+ with an auto-renewed certificate.

## Go-live checklist
See `docs/GO_LIVE_READINESS.md` §"Go-live checklist".
