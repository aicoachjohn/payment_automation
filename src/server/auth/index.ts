/**
 * Session handling, RBAC guard and the permission matrix (FRD §2.2).
 * Phase 2 builds the full auth flow; Phase 1 ships only the password helper so the
 * seed can create users.
 */
export { hashPassword, verifyPassword } from "./password";
