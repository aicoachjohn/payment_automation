# Requirements Index

Maps each FRD requirement ID group to the phase(s) that implement it. The phase
assignments are taken from the Build Prompt Pack phase map (see
`docs/ProITbridge_ClaudeCode_Build_Prompt_Pack.md`). Individual requirement IDs are
tracked per phase as they are built; this index is the group-level map.

Source of truth for the requirements themselves: `docs/FRD_v1.2.pdf` (v1.2, 11 Aug 2026).

## ID group → implementing phase(s)

| ID group | Meaning | Approx. count | Primary phase(s) |
|---|---|---|---|
| **FR-AUTH** | Authentication (login, password policy, 2FA, sessions, lockout) | 11 | Phase 2 |
| **FR-SAL** | Sales module (leads, details, course/plan, concession, draft, payment capture, automation) | 71 | Phases 3, 4, 5, 6, 10 |
| **FR-DM** | Data Management dashboard — Level-1 audit | 45 | Phase 7 |
| **FR-FIN** | Finance dashboard (read-only) | 26 | Phase 8 |
| **FR-SA** | Super Admin console & override authority | 20 | Phase 9 |
| **FR-ADM** | Administration — Pricing Master, templates, reason codes | 10 | Phases 3, 5, 9 |
| **FR-AUD** | Audit trail (immutable, append-only, field-level) | 5 | Phase 1 |
| **FR-SEC** | Security (RBAC, hashing, file security, headers, CSRF) | ~40 | Phases 1, 2, 6, 12 |
| **FR-REC** | Reconciliation & integrity (unique Txn ID, balance, rounding) | 18 | Phases 1, 11 |
| **BR** | Business rules (BR-01 … BR-30) | 30 | All phases (core in Phase 1) |
| **NFR** | Non-functional requirements (performance, security, usability, config) | ~21 | Phases 0, 2, 12 |

## Phase map (from the Build Prompt Pack)

| Phase | Name | FRD coverage |
|---|---|---|
| 0 | Foundation & Project Constitution | §14, NFR-16 |
| 1 | Data Model, Money & Audit Core | §10, BR-28/29, FR-AUD-01..05, FR-SEC-19 |
| 2 | Auth, RBAC & Security Baseline | FR-AUTH-01..11, FR-SEC-01..09, NFR-05/07 |
| 3 | Pricing Master & Fee Engine | FR-SAL-14..31, FR-ADM-01..09, BR-01..04/13/19 |
| 4 | Sales — Leads & Basic Details | FR-SAL-01..13, BR-02 |
| 5 | Payment Draft Generator | FR-SAL-32..37, FR-ADM-06 |
| 6 | Payment Capture, Proof Upload & OCR | FR-SAL-38..48, FR-SEC-20..26, BR-05/06/20 |
| 7 | Data Management Dashboard (L1 Audit) | FR-DM-01..45, BR-15..17/27 |
| 8 | Finance Dashboard | FR-FIN-01..26, BR-18 |
| 9 | Super Admin Console & Audit Trail UI | FR-SA-01..20, FR-ADM-10, BR-23..26 |
| 10 | Automation Engine | FR-SAL-49..71, BR-07..12 |
| 11 | Reconciliation & Integrity | FR-REC-01..18, BR-30 |
| 12 | Hardening, Testing, UAT & Deployment | §11, §12.4–12.6, §15.1 |

> Note: several ID groups span multiple phases (notably FR-SAL, FR-SEC and BR). The
> "Primary phase(s)" column lists where the bulk of each group is delivered; the phase
> map above is authoritative for exact ID ranges.
