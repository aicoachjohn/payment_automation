"use server";

import { headers } from "next/headers";
import { actionClient } from "@/server/safe-action";
import { rateLimit } from "@/server/auth/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { submitIntakeSchema } from "@/lib/schemas";
import { submitIntake } from "@/server/services/lead-intake-link";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

/**
 * PUBLIC (unauthenticated) submit for the self-intake form — built on the plain `actionClient`
 * like the (auth) pages. Token-gated + rate-limited + honeypot; the token is the real gate.
 */
export const submitIntakeAction = actionClient
  .schema(submitIntakeSchema)
  .action(async ({ parsedInput }) => {
    const ip = await clientIp();
    if (!rateLimit(`intake:${ip ?? "unknown"}`, RATE_LIMITS.intake).allowed) {
      return { ok: false as const, error: "Too many attempts. Please wait a minute and try again." };
    }
    // Honeypot: a filled `company` means a bot — accept silently without creating anything.
    if (parsedInput.company) return { ok: true as const };
    const { token, company: _company, ...data } = parsedInput;
    void _company;
    return submitIntake(token, data, ip);
  });
