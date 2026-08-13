# Privileged Access Register (Phase 12, FR-SEC-46)

Records who holds each privileged credential at go-live. **Reviewed whenever a team
member joins or leaves**, and quarterly by the Super Admin (see `RUNBOOK.md`). All names
are `TODO-BUSINESS` placeholders to be filled during go-live provisioning (D-06).

## Application privileged accounts

| Credential | Holder | Notes |
|---|---|---|
| Super Admin (single, active) | `TODO-BUSINESS` | Nominated person OUTSIDE Sales/Data-Mgmt/Finance (BR-23, A-09). |
| Break-glass Super Admin | `TODO-BUSINESS` | Documented, sealed; any login alerts the primary Super Admin + Rajesh (NFR-07a). |
| Finance reviewer (Rajesh) | Rajesh | Read-only on payment data (BR-18); receives every override notice. |
| Data-Mgmt auditor (Nandhiya) | Nandhiya | Sole L1 auditor; Super Admin is the delegated backup (A-04, FR-SA-13). |
| Sales Manager | `TODO-BUSINESS` | Nominated (Q-03). |

## Infrastructure privileged credentials

| Credential | Holder | Custody |
|---|---|---|
| DB owner role (`DIRECT_URL`) | `TODO-BUSINESS` | Migrations only; not used by the running app. |
| DB app role (`proitbridge_app`) | Application (secret store) | Least-privilege; UPDATE/DELETE revoked on audit tables. |
| Cloud/console admin | `TODO-BUSINESS` | MFA enforced. |
| Object-store keys | Application (secret store) | Private bucket; signed URLs only. |
| Email/OCR API keys | Application (secret store) | Rotated on staff change. |
| `AUTH_SECRET` / `PROOF_SIGNING_SECRET` / `CRON_SECRET` | Secret store | Rotated on suspected compromise. |

## Review log

| Date | Reviewer | Change |
|---|---|---|
| `TODO` (go-live) | Super Admin | Initial register created. |
