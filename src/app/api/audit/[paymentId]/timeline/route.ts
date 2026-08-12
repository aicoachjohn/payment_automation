/**
 * Immutable audit-timeline PDF for a payment, for dispute resolution (FR-DM-45).
 * Requires audit:read:all (auditor, manager, finance, super admin); re-verified here.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession } from "@/server/auth/session";
import { hasPermission, AuthorizationError } from "@/server/auth/permissions";
import { auditTimeline } from "@/server/services/audit-decisions";

function safe(text: string): string {
  return text.replace(/[₹]/g, "Rs.").replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}

export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(ctx.actor.role, "audit:read:all")) return new Response("Forbidden", { status: 403 });

  const { paymentId } = await params;
  let timeline;
  try {
    timeline = await auditTimeline(ctx.actor, paymentId);
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response("Forbidden", { status: 403 });
    throw e;
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage();
  let y = page.getSize().height - 50;
  const line = (text: string, f = font, size = 10) => {
    if (y < 50) { page = doc.addPage(); y = page.getSize().height - 50; }
    page.drawText(safe(text).slice(0, 110), { x: 50, y, size, font: f, color: rgb(0.1, 0.1, 0.15) });
    y -= size + 4;
  };

  line(`Audit history — payment ${paymentId}`, bold, 13);
  y -= 6;
  for (const e of timeline) {
    line(`${e.at}  ${e.byName} (${e.role})  ${e.action}`, bold, 10);
    if (e.field) line(`   ${e.field}: ${e.oldValue ?? "(none)"} -> ${e.newValue ?? "(none)"}`);
    y -= 2;
  }

  const bytes = await doc.save();
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="audit-timeline-${paymentId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
