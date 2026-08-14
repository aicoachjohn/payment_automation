/**
 * In-app image serving for a LEAD-uploaded (self-intake) payment proof, so the salesperson can
 * SEE it while confirming (BR-20). Session-gated + ownership-checked (the actor must own the
 * lead). Streamed from private storage; no public link. Once confirmed, the proof becomes a
 * normal PaymentProof served via /api/proofs.
 */
import { getSession } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/permissions";
import { getSelfProofForActor } from "@/server/services/lead-intake-link";
import { readProofBytes } from "@/server/services/payments";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  let held;
  try {
    held = await getSelfProofForActor(ctx.actor, id);
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  if (!held) return new Response("Not found", { status: 404 });

  const bytes = await readProofBytes(held.storageKey);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": held.fileType,
      "Content-Disposition": 'inline; filename="learner-proof"',
      "Cache-Control": "private, no-store",
    },
  });
}
