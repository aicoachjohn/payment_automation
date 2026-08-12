/**
 * Shared constants. Security parameters that are NOT per-deployment configurable live
 * here; anything the Super Admin may tune (session timeouts, GST, windows) lives in
 * SystemConfig and is read via src/server/services/system-config (BR-13, NFR-16).
 */

export const SESSION_COOKIE = "pib_session";

/** The visible mark for a payment the Super Admin audited via delegation (FR-SA-13).
 *  Shown identically on the Sales, Data Management and Finance views and in history. */
export const DELEGATED_AUDIT_LABEL = "Audited by Super Admin (delegated)";

export const SECURITY = {
  /** Lock the account after this many consecutive failed logins (FR-AUTH-07). */
  MAX_FAILED_LOGINS: 5,
  /** Lockout duration in minutes (FR-AUTH-07, FR-SEC-07). */
  LOCKOUT_MINUTES: 15,
  /** Email OTP length, lifetime and max attempts (FR-AUTH-10, FR-SEC-05). */
  OTP_LENGTH: 6,
  OTP_TTL_MINUTES: 10,
  OTP_MAX_ATTEMPTS: 5,
  /** Single-use password reset link lifetime (FR-AUTH-05). */
  RESET_TTL_MINUTES: 30,
  /** Absolute session lifetime regardless of activity. */
  SESSION_ABSOLUTE_HOURS: 12,
  /** Fallbacks if SystemConfig is unavailable (FR-AUTH-06, NFR-07a). */
  DEFAULT_SESSION_TIMEOUT_MINUTES: 30,
  SUPERADMIN_SESSION_TIMEOUT_MINUTES: 15,
} as const;

/** Password policy (FR-AUTH-04): ≥8 chars, ≥1 uppercase, ≥1 number, ≥1 special. */
export const PASSWORD_POLICY = {
  minLength: 8,
  message:
    "Password must be at least 8 characters and include an uppercase letter, a number and a special character.",
} as const;

/**
 * Fixed-window rate limits (per key, usually per-IP+route) — FR-SEC-07. Kept generous
 * per IP because internal users often share an office NAT; per-account lockout
 * (MAX_FAILED_LOGINS) is the tighter, targeted control.
 */
export const RATE_LIMITS = {
  login: { limit: 20, windowMs: 60_000 },
  forgotPassword: { limit: 10, windowMs: 60_000 },
  otp: { limit: 20, windowMs: 60_000 },
} as const;
