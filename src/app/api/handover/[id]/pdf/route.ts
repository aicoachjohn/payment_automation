/**
 * Operations handover PDF (FR-SAL-71). The consolidated learner/payment record as a
 * single-file PDF. Auth + record-access are re-verified via the getHandover service.
 * pdf-lib fonts are WinAnsi, so ₹ is ASCII-safed to "Rs.".
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession } from "@/server/auth/session";
import { getHandover, HandoverError } from "@/server/services/handover";
import { formatINR, formatDate } from "@/lib/format";

function ascii(s: string): string {
  return s.replace(/₹/g, "Rs.").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  let h;
  try {
    h = await getHandover(ctx.actor, id);
  } catch (e) {
    if (e instanceof HandoverError) return new Response("Not found", { status: 404 });
    throw e;
  }
  const r = h.record;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]); // A4 portrait
  let y = 800;
  const line = (text: string, size = 10, f = font) => {
    if (y < 48) { page = doc.addPage([595, 842]); y = 800; }
    page.drawText(ascii(text), { x: 40, y, size, font: f, color: rgb(0.1, 0.1, 0.14) });
    y -= size + 6;
  };
  const heading = (t: string) => { y -= 6; line(t, 12, bold); };

  line(`Operations Handover — ${r.learner.fullName}`, 16, bold);
  line(`${h.type} · ${h.validated ? "Validated" : "Incomplete"}${h.handoverDate ? ` · ${formatDate(h.handoverDate)}` : ""}`, 9);
  if (h.missing.length) line(`Incomplete: ${h.missing.join("; ")}`, 9);

  heading("Learner");
  line(`Name: ${r.learner.fullName}`);
  line(`DOB: ${r.learner.dob ? formatDate(r.learner.dob) : "-"}    Mobile: ${r.learner.mobile ?? "-"}    Email: ${r.learner.email ?? "-"}`);
  line(`Address: ${r.learner.address ?? "-"}`);

  heading("Course");
  line(`Program: ${r.course.program}    Plan: ${r.course.plan}    Combo: ${r.course.comboMode ?? "-"}`);
  line(`Commencing: ${r.course.commencingDate ? formatDate(r.course.commencingDate) : "-"}    Batch: ${r.course.batch ?? "-"}`);

  heading("Pricing");
  line(`Standard: ${r.pricing.standardFee ? formatINR(r.pricing.standardFee) : "-"}    Concession: ${formatINR(r.pricing.concession)}    Final: ${r.pricing.finalApprovedFee ? formatINR(r.pricing.finalApprovedFee) : "-"}`);

  heading("Payments");
  for (const p of r.payments) {
    line(`#${p.number} ${p.type}  ${formatINR(p.received)}  ${formatDate(p.date)}  Txn ${p.transactionId}  proof:${p.hasProof ? "yes" : "no"}  ${p.auditStatus}`);
  }
  line(`Total received: ${formatINR(r.totals.totalReceived)}    Balance: ${formatINR(r.totals.balance)}`, 10, bold);

  heading("Sales");
  line(`Salesperson: ${r.sales.salesperson}    Lead source: ${r.sales.leadSource ?? "-"}`);
  line(`Enrollment date: ${formatDate(r.sales.enrollmentDate)}`);
  if (r.sales.remarks) line(`Remarks: ${r.sales.remarks}`);

  const bytes = await doc.save();
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="handover-${id}.pdf"`, "Cache-Control": "no-store" },
  });
}
