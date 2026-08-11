/**
 * Password hashing (FR-SEC-04, NFR-05).
 *
 * Uses bcrypt (via bcryptjs, pure-JS, no native build) — the FRD-sanctioned fallback
 * to Argon2id (see CLAUDE.md). Passwords are one-way hashed, never stored, logged or
 * returned in readable form, and never recoverable — only resettable. Phase 2 owns the
 * full auth flow; this helper exists in Phase 1 only so the seed can create users.
 */
import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
