"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/server/auth/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { submitIntakeSchema } from "@/lib/schemas";
import { submitIntake } from "@/server/services/lead-intake-link";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

const FIELDS = [
  "token", "fullName", "dob", "doorNo", "street", "address", "district", "state",
  "pincode", "email", "mobile", "interestedProgram", "interestedPlan", "company",
] as const;

/**
 * PUBLIC (unauthenticated) multipart submit for the self-intake form: the lead's details +
 * optional payment screenshot(s). Token-gated + rate-limited + honeypot. The proof is staged
 * and HELD for the salesperson to confirm — it is never captured as a payment here.
 */
export async function submitIntakeAction(formData: FormData) {
  const ip = await clientIp();
  if (!rateLimit(`intake:${ip ?? "unknown"}`, RATE_LIMITS.intake).allowed) {
    return { ok: false as const, error: "Too many attempts. Please wait a minute and try again." };
  }
  const raw = Object.fromEntries(FIELDS.map((k) => [k, String(formData.get(k) ?? "")]));
  const parsed = submitIntakeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please check the highlighted fields and try again." };
  if (parsed.data.company) return { ok: true as const }; // honeypot filled → silently accept
  const { token, company: _company, ...data } = parsed.data;
  void _company;

  const files = formData.getAll("file").filter((f): f is File => f instanceof File).slice(0, 8);
  const proofs = await Promise.all(
    files.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), originalFilename: f.name })),
  );
  return submitIntake(token, data, ip, proofs);
}
