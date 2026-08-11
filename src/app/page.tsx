import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { ROLE_HOME } from "@/server/auth/permissions";

/**
 * Root entry. Authenticated, fully-verified users go to their role dashboard; everyone
 * else goes to sign-in. There is no public landing content — this is an internal system
 * with no self-service signup (FR-SEC-01).
 */
export default async function Home() {
  const ctx = await getSession();
  if (ctx && ctx.session.twoFaVerified && !ctx.user.mustChangePassword) {
    redirect(ROLE_HOME[ctx.user.role]);
  }
  redirect("/login");
}
