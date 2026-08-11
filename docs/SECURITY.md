# Security — where each requirement is satisfied (Phase 2)

This maps the FR-SEC / FR-AUTH requirements to the code that satisfies them. RBAC is
enforced server-side on every request; hiding UI is never the control (FR-SEC-02/03).

## Authentication (FR-AUTH-01…11)

| Requirement | Where |
|---|---|
| FR-AUTH-01/03 Email+password, route to role dashboard | `src/server/services/auth.ts` `login()`; `ROLE_HOME` in `permissions.ts` |
| FR-AUTH-04 Password policy + forced first-login change | `isPasswordStrong()` in `auth/password.ts`, `changePasswordSchema` in `lib/schemas.ts`, `must_change_password` gate in `guard.ts` |
| FR-AUTH-05 Forgot-password: single-use, 30-min, hashed token, no enumeration | `requestPasswordReset()` / `resetPassword()`; identical response in `forgotPasswordAction` |
| FR-AUTH-06 / NFR-07a Session timeout 30 min (15 for Super Admin) | `getSession()` in `auth/session.ts`, `getSessionTimeoutMinutes()` reads SystemConfig |
| FR-AUTH-07 Lockout after 5 fails (15 min) + alert | `login()` failure branch → `lockedUntil`, `ACCOUNT_LOCKED`, notify Super Admin |
| FR-AUTH-09 Log login/logout/failed with user+IP+time | `logSecurity()` → `SecurityEvent` |
| FR-AUTH-10 Email OTP 2FA, mandatory for SA/Data-Mgmt/Finance | `TWO_FA_MANDATORY_ROLES`, `issueOtp()`, `verifyOtp()`, OTP screen |
| FR-AUTH-11 One Super Admin; break-glass alerts | `assertSingleSuperAdmin()` in `services/users.ts`; break-glass alert in `login()` |

## Access security (FR-SEC-01…09)

| Requirement | Where |
|---|---|
| FR-SEC-01 No public signup | No registration route exists; users created only via `services/users.ts` (`user:manage`) |
| FR-SEC-02 Deny-by-default, server-side every request | `middleware.ts` (route gate) + `safe-action.ts` (`authActionClient`/`withPermission`) + `guard.ts` |
| FR-SEC-03 Re-verify identity/role/ownership per request | `getSession()` loads fresh user; `requirePermission` / `requireRecordAccess` / `canEditPaymentRecord` |
| FR-SEC-04 Strong one-way hash; never logged/returned/recoverable | bcrypt in `auth/password.ts`; password never selected into client payloads |
| FR-SEC-05 2FA mandatory for SA/Finance/Data-Mgmt | `TWO_FA_MANDATORY_ROLES` in `services/auth.ts` |
| FR-SEC-06 Session expiry + full server-side invalidation | `Session` table; `revokeCurrentSession` / `revokeAllUserSessions` |
| FR-SEC-07 Lockout + rate limiting on login/reset/OTP | `rate-limit.ts` used in `(auth)/actions.ts`; account lockout in `login()` |
| FR-SEC-08 Deactivate → revoke sessions immediately | `setUserStatus()` and role change call `revokeAllUserSessions`; `getSession` rejects non-ACTIVE users |
| FR-SEC-09 Optional office-IP restriction for SA/Finance | Deferred to Phase 12 (deployment-level); noted here |

## The permission layer (FRD §2.2)

`src/server/auth/permissions.ts` encodes the matrix as DATA (`ROLE_PERMISSIONS`).
`tests/unit/permissions.test.ts` walks every cell (124 assertions) and is the
specification. Invariants enforced and tested:

- **FINANCE_REVIEWER holds no write permission of any kind** (BR-18).
- **`payment:edit-amount` does not exist** as a permission anywhere (FR-SA-08, BR-24) —
  the Super Admin cannot directly edit a payment amount/date/Txn ID.
- **Only DATA_MGMT_AUDITOR holds `payment:audit`**; the Super Admin gets it only via the
  Phase-9 delegated path.
- A **salesperson may edit a payment only while PENDING_AUDIT / CORRECTION_REQUIRED and
  only if they own the lead** — `canEditPaymentRecord()` (a function, not a comment).

Every mutating server action is built on `authActionClient` or `withPermission(...)`, so
each one re-authenticates and re-authorises. No action grants Finance a write.

## Security baseline (FR-SEC-27…31)

| Control | Where |
|---|---|
| Security headers: CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy no-referrer, Permissions-Policy | `next.config.ts` `headers()` |
| CSRF on state-changing ops | Server actions only + Next same-origin enforcement + `SameSite=Lax`, `httpOnly` session cookie |
| Zod validation server-side on every input | `lib/schemas.ts` via next-safe-action `.schema()` |
| Errors never leak stack/SQL/path/id | `handleServerError` in `safe-action.ts`; `AuthorizationError`/`UserServiceError` carry safe messages |
| No personal data / amount / Txn ID in URLs or logs | Tokens are POST bodies; `SecurityEvent.details` stores reasons/counts, never secrets |

## Notes / deferred

- Rate limiting is in-memory (single node); back with Redis in Phase 12 (multi-node).
- `E2E_FIXED_OTP` is a test-only hook, active only when `NODE_ENV !== production`.
- CSP allows the inline/eval the Next dev runtime needs; tighten with nonces in Phase 12.
