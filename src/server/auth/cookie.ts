/**
 * Edge-safe session cookie signing/verifying (jose only — no Node crypto, no Prisma),
 * so it can run in Next middleware AND in Node server code.
 *
 * The cookie is a signed JWT carrying only { sid, role }. `sid` is an opaque session
 * reference; the AUTHORITATIVE session state (revocation, timeout, 2FA, deactivation)
 * lives in the database and is checked server-side on every request (see session.ts).
 * The signature lets middleware do a coarse role-gate without a DB round-trip.
 */
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
import { SESSION_COOKIE } from "@/lib/constants";

export { SESSION_COOKIE };

export interface SessionCookiePayload {
  sid: string;
  role: Role;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is not configured.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionCookie(payload: SessionCookiePayload): Promise<string> {
  return new SignJWT({ sid: payload.sid, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey());
}

export async function verifySessionCookie(
  token: string | undefined,
): Promise<SessionCookiePayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sid !== "string" || typeof payload.role !== "string") return null;
    return { sid: payload.sid, role: payload.role as Role };
  } catch {
    return null;
  }
}
