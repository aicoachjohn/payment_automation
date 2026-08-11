/**
 * Edge middleware — the FIRST line of role enforcement (FR-AUTH-03, FR-SEC-02/03).
 *
 * It does a coarse, signature-verified role gate without a DB round-trip:
 *   - unauthenticated on a protected route → redirect to /login?next=…
 *   - authenticated but WRONG role → 403 (never a redirect that leaks route existence)
 *
 * The authoritative checks (session revocation, timeout, 2FA, deactivation) happen
 * server-side in the layouts/actions. Hiding a route here is never the only control.
 *
 * Kept dependency-light on purpose: it must run on the edge runtime, so it uses the
 * jose-only cookie module and role STRING literals (no @prisma/client import).
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionCookie, SESSION_COOKIE } from "@/server/auth/cookie";

const ROUTE_ACCESS: { prefix: string; roles: string[] }[] = [
  { prefix: "/sales", roles: ["SALESPERSON", "SALES_MANAGER"] },
  { prefix: "/audit", roles: ["DATA_MGMT_AUDITOR"] },
  { prefix: "/finance", roles: ["FINANCE_REVIEWER"] },
  { prefix: "/admin", roles: ["SUPER_ADMIN"] },
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const match = ROUTE_ACCESS.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  if (!match) return NextResponse.next();

  const payload = await verifySessionCookie(req.cookies.get(SESSION_COOKIE)?.value);

  if (!payload) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!match.roles.includes(payload.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/sales/:path*", "/audit/:path*", "/finance/:path*", "/admin/:path*"],
};
