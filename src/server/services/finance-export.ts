/**
 * Finance report exports (FR-FIN-08/15/25). Two formats per report:
 *   - CSV  — full fidelity, Excel-compatible, columns in the exact on-screen order
 *            (the SAME column specs the tables render, from `@/lib/finance-columns`).
 *   - PDF  — a titled, paginated landscape table via pdf-lib (WinAnsi, so ₹ is ASCII-
 *            safed to "Rs.").
 *
 * Every export is logged with user, report, applied filters and record count
 * (FR-AUD-05, FR-SEC-42) by the caller-facing wrappers here — there is no path that
 * returns a file without recording it. This module performs READS ONLY on payment data.
 */
import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { requirePermission, type Actor } from "@/server/auth/permissions";
import {
  financeStatement,
  customerMaster,
  outstandingReport,
  monthlyCollectionSummary,
  gstSummary,
  type StatementFilters,
  type CustomerFilters,
} from "@/server/services/finance";
import { STATEMENT_COLUMNS, CUSTOMER_COLUMNS, OUTSTANDING_COLUMNS, type Column } from "@/lib/finance-columns";
import { formatINR } from "@/lib/format";

export type FinanceReport = "statement" | "customers" | "outstanding" | "monthly" | "gst";
export type ExportFormat = "csv" | "pdf";

/**
 * Record that a Finance report was exported — user, report, applied filters and record
 * count (FR-AUD-05, FR-SEC-42). Appends one immutable audit entry; no payment data is
 * mutated. Every export path below calls this, so no file leaves unlogged.
 */
export async function logFinanceExport(
  actor: Actor,
  report: string,
  filters: Record<string, unknown>,
  recordCount: number,
): Promise<void> {
  requirePermission(actor, "finance:read");
  await db.$transaction(async (tx) => {
    await writeAudit(tx, {
      entityType: "FinanceReport",
      entityId: report,
      action: "EXPORT",
      changes: [
        { field: "filters", oldValue: null, newValue: JSON.stringify(filters) },
        { field: "recordCount", oldValue: null, newValue: recordCount },
      ],
      actor,
    });
  });
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function buildCsv<T>(columns: Column<T>[], rows: T[]): string {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((r) => columns.map((c) => csvEscape(c.get(r))).join(","));
  return [header, ...lines].join("\r\n");
}

// ── PDF (landscape table) ──────────────────────────────────────────────────────

/** ASCII-safe a string for pdf-lib's WinAnsi fonts (₹ → "Rs.", – → "-"). */
function asciiSafe(s: string): string {
  return s.replace(/₹/g, "Rs.").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
}

async function tablePdf(opts: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
  footer?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = 842; // A4 landscape
  const pageH = 595;
  const margin = 32;
  const usableW = pageW - margin * 2;
  const ncols = opts.headers.length;
  const colW = usableW / ncols;
  const rowH = 16;
  const fontSize = 7;

  const maxChars = Math.max(4, Math.floor(colW / (fontSize * 0.55)));
  const drawCell = (page: ReturnType<typeof doc.addPage>, text: string, x: number, y: number, f = font) => {
    const safe = asciiSafe(text).slice(0, maxChars);
    page.drawText(safe, { x: x + 2, y, size: fontSize, font: f, color: rgb(0.1, 0.1, 0.12) });
  };

  let page = doc.addPage([pageW, pageH]);
  page.drawText(asciiSafe(opts.title), { x: margin, y: pageH - margin, size: 14, font: bold, color: rgb(0.05, 0.09, 0.16) });
  page.drawText(asciiSafe(opts.subtitle), { x: margin, y: pageH - margin - 16, size: 8, font, color: rgb(0.35, 0.4, 0.46) });

  let y = pageH - margin - 40;
  const drawHeader = () => {
    opts.headers.forEach((h, i) => drawCell(page, h, margin + i * colW, y, bold));
    y -= rowH;
  };
  drawHeader();

  for (const row of opts.rows) {
    if (y < margin + rowH) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
      drawHeader();
    }
    row.forEach((cell, i) => drawCell(page, cell, margin + i * colW, y));
    y -= rowH;
  }

  if (opts.footer) {
    if (y < margin + rowH) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    page.drawText(asciiSafe(opts.footer), { x: margin, y: y - 6, size: 9, font: bold, color: rgb(0.05, 0.09, 0.16) });
  }
  return doc.save();
}

// ── Report dispatch ─────────────────────────────────────────────────────────

export interface ExportResult {
  filename: string;
  contentType: string;
  body: string | Uint8Array;
  recordCount: number;
}

function filtersSubtitle(filters: Record<string, unknown>): string {
  const parts = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? `Filters — ${parts.join("; ")}` : "No filters applied";
}

/**
 * Build the requested report in the requested format, and LOG the export. Returns the
 * bytes/string plus metadata for the HTTP response. Reads only.
 */
export async function exportFinanceReport(
  actor: Actor,
  report: FinanceReport,
  format: ExportFormat,
  params: { statement?: StatementFilters; customers?: CustomerFilters; year?: number; month?: number },
): Promise<ExportResult> {
  const stamp = "report";
  switch (report) {
    case "statement": {
      const filters = params.statement ?? {};
      const { rows, total } = await financeStatement(actor, filters);
      await logFinanceExport(actor, "statement", filters as Record<string, unknown>, rows.length);
      if (format === "csv") {
        return {
          filename: `finance-statement-${stamp}.csv`,
          contentType: "text/csv; charset=utf-8",
          body: buildCsv(STATEMENT_COLUMNS, rows),
          recordCount: rows.length,
        };
      }
      const body = await tablePdf({
        title: "Finance — Approved Payment Statement",
        subtitle: filtersSubtitle(filters as Record<string, unknown>),
        headers: STATEMENT_COLUMNS.map((c) => c.header),
        rows: rows.map((r) => STATEMENT_COLUMNS.map((c) => c.get(r))),
        footer: `Records: ${rows.length}   Total received: ${formatINR(total)}`,
      });
      return { filename: `finance-statement-${stamp}.pdf`, contentType: "application/pdf", body, recordCount: rows.length };
    }
    case "customers": {
      const filters = params.customers ?? {};
      const rows = await customerMaster(actor, filters);
      await logFinanceExport(actor, "customers", filters as Record<string, unknown>, rows.length);
      if (format === "csv") {
        return {
          filename: `finance-customers-${stamp}.csv`,
          contentType: "text/csv; charset=utf-8",
          body: buildCsv(CUSTOMER_COLUMNS, rows),
          recordCount: rows.length,
        };
      }
      const body = await tablePdf({
        title: "Finance — Customer Master",
        subtitle: filtersSubtitle(filters as Record<string, unknown>),
        headers: CUSTOMER_COLUMNS.map((c) => c.header),
        rows: rows.map((r) => CUSTOMER_COLUMNS.map((c) => c.get(r))),
        footer: `Customers: ${rows.length}`,
      });
      return { filename: `finance-customers-${stamp}.pdf`, contentType: "application/pdf", body, recordCount: rows.length };
    }
    case "outstanding": {
      const { rows, total } = await outstandingReport(actor);
      await logFinanceExport(actor, "outstanding", {}, rows.length);
      if (format === "csv") {
        return {
          filename: `finance-outstanding-${stamp}.csv`,
          contentType: "text/csv; charset=utf-8",
          body: buildCsv(OUTSTANDING_COLUMNS, rows),
          recordCount: rows.length,
        };
      }
      const body = await tablePdf({
        title: "Finance — Outstanding Balances",
        subtitle: `Learners with a balance greater than zero`,
        headers: OUTSTANDING_COLUMNS.map((c) => c.header),
        rows: rows.map((r) => OUTSTANDING_COLUMNS.map((c) => c.get(r))),
        footer: `Learners: ${rows.length}   Total outstanding: ${formatINR(total)}`,
      });
      return { filename: `finance-outstanding-${stamp}.pdf`, contentType: "application/pdf", body, recordCount: rows.length };
    }
    case "monthly": {
      const now = new Date();
      const year = params.year ?? now.getUTCFullYear();
      const month = params.month ?? now.getUTCMonth() + 1;
      const s = await monthlyCollectionSummary(actor, year, month);
      await logFinanceExport(actor, "monthly", { year, month }, s.count);
      const headers = ["Section", "Key", "Value", "Count"];
      const rows: string[][] = [
        ["Total", "All approved", formatINR(s.total), String(s.count)],
        ...s.byType.map((t) => ["By Type", t.label, formatINR(t.value), String(t.count)]),
        ...s.byProgram.map((p) => ["By Program", p.key, formatINR(p.value), String(p.count)]),
        ...s.byPlan.map((p) => ["By Plan", p.key, formatINR(p.value), String(p.count)]),
        ...s.bySalesperson.map((p) => ["By Salesperson", p.name, formatINR(p.value), String(p.count)]),
      ];
      if (format === "csv") {
        return {
          filename: `finance-monthly-${year}-${month}.csv`,
          contentType: "text/csv; charset=utf-8",
          body: [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n"),
          recordCount: s.count,
        };
      }
      const body = await tablePdf({
        title: `Finance — Monthly Collection Summary (${month}/${year})`,
        subtitle: `Approved collection only`,
        headers,
        rows,
        footer: `Total approved collection: ${formatINR(s.total)} across ${s.count} payments`,
      });
      return { filename: `finance-monthly-${year}-${month}.pdf`, contentType: "application/pdf", body, recordCount: s.count };
    }
    case "gst": {
      const now = new Date();
      const year = params.year ?? now.getUTCFullYear();
      const month = params.month ?? now.getUTCMonth() + 1;
      const g = await gstSummary(actor, year, month);
      await logFinanceExport(actor, "gst", { year, month }, g.count);
      const headers = ["Metric", "Value"];
      const rows: string[][] = [
        ["Base value", formatINR(g.base)],
        ["GST component", formatINR(g.gst)],
        ["Total collection", formatINR(g.total)],
        ["Payments", String(g.count)],
      ];
      if (format === "csv") {
        return {
          filename: `finance-gst-${year}-${month}.csv`,
          contentType: "text/csv; charset=utf-8",
          body: [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n"),
          recordCount: g.count,
        };
      }
      const body = await tablePdf({
        title: `Finance — GST Summary (${month}/${year})`,
        subtitle: `Base + GST of approved collections`,
        headers,
        rows,
        footer: `Base ${formatINR(g.base)} + GST ${formatINR(g.gst)} = ${formatINR(g.total)}`,
      });
      return { filename: `finance-gst-${year}-${month}.pdf`, contentType: "application/pdf", body, recordCount: g.count };
    }
    default: {
      const _exhaustive: never = report;
      throw new Error(`Unknown report: ${_exhaustive}`);
    }
  }
}
