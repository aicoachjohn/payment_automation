/**
 * Server-side PDF of the payment draft (FR-SAL-34). GET /api/leads/[id]/draft[?version=N].
 * Auth + ownership are re-verified on this request (FR-SEC-03); the PDF is streamed as an
 * attachment. pdf-lib standard fonts are WinAnsi, so glyphs like ₹/•/— are ASCII-safed
 * for the PDF only — the clipboard/email copy keeps the proper characters.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession } from "@/server/auth/session";
import { getDraftVersion, DraftError } from "@/server/services/draft";
import { AuthorizationError } from "@/server/auth/permissions";

function pdfSafe(text: string): string {
  return text
    .replace(/₹/g, "Rs. ")
    .replace(/[•]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // drop anything outside basic Latin-1 that WinAnsi can't encode
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}

function wrap(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const words = line.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) out.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;
  const versionParam = new URL(req.url).searchParams.get("version");
  const version = versionParam ? Number(versionParam) : undefined;

  let draft;
  try {
    draft = await getDraftVersion(ctx.actor, id, version && Number.isFinite(version) ? version : undefined);
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response("Forbidden", { status: 403 });
    if (e instanceof DraftError) return new Response("Not found", { status: 404 });
    throw e;
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const lineHeight = 15;
  const margin = 50;
  let page = doc.addPage();
  let y = page.getSize().height - margin;

  const lines = pdfSafe(draft.content).split("\n").flatMap((l) => wrap(l, 92));
  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage();
      y = page.getSize().height - margin;
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.15) });
    y -= lineHeight;
  }

  const bytes = await doc.save();
  const filename = `payment-draft-v${draft.version}.pdf`;
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
