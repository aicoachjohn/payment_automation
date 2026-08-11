/**
 * Password hashing & policy (FR-SEC-04, FR-AUTH-04, NFR-05).
 *
 * Uses bcrypt (via bcryptjs, pure-JS, no native build) — the FRD-sanctioned fallback
 * to Argon2id (see CLAUDE.md). Passwords are one-way hashed, never stored, logged or
 * returned in readable form, and never recoverable — only resettable.
 */
import bcrypt from "bcryptjs";
import { PASSWORD_POLICY } from "@/lib/constants";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Enforce the password policy: ≥8 chars, ≥1 uppercase, ≥1 number, ≥1 special char.
 * Returns a single safe message on failure (used by the Zod schema and the service).
 */
export function isPasswordStrong(plain: string): boolean {
  return (
    plain.length >= PASSWORD_POLICY.minLength &&
    /[A-Z]/.test(plain) &&
    /[0-9]/.test(plain) &&
    /[^A-Za-z0-9]/.test(plain)
  );
}
