/**
 * Payment-proof access (FR-SEC-20/21/25). GET /api/proofs/[proofId]?token=<signed>.
 * Two gates, both required: a valid 2FA session with record access (ownership), AND a
 * valid, unexpired signed token. Every view is logged. Files are streamed from private
 * storage — there is no public link.
 */
import { getSession } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/permissions";
import { getProofForActor, readProofBytes, logProofAccess } from "@/server/services/payments";
import { verifyProofToken } from "@/server/storage";

export async function GET(req: Request, { params }: { params: Promise<{ proofId: string }> }) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) return new Response("Unauthorized", { status: 401 });

  const { proofId } = await params;
  const token = new URL(req.url).searchParams.get("token");

  let proof;
  try {
    proof = await getProofForActor(ctx.actor, proofId);
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
  if (!proof) return new Response("Not found", { status: 404 });

  // The signed token must be valid AND unexpired (mimics an S3 presigned URL).
  if (!verifyProofToken(proofId, token)) {
    return new Response("This link is invalid or has expired.", { status: 403 });
  }

  const bytes = await readProofBytes(proof.filePath);
  await logProofAccess(proofId, ctx.actor.userId, "PROOF_VIEW");

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": proof.fileType,
      "Content-Disposition": `inline; filename="proof-v${proof.version}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
