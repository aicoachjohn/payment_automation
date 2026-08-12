/**
 * Finance report export (FR-FIN-08/15/25). Streams CSV or PDF for the selected report
 * with the applied filters intact, and logs the export (FR-AUD-05, FR-SEC-42) via the
 * export service. Finance-only, re-verified on the request (deny-by-default). Reads
 * only — no payment data is mutated.
 */
import { PaymentType, Program, Plan } from "@prisma/client";
import { getSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { exportFinanceReport, type FinanceReport, type ExportFormat } from "@/server/services/finance-export";
import type { StatementFilters, CustomerFilters } from "@/server/services/finance";

const REPORTS: FinanceReport[] = ["statement", "customers", "outstanding", "monthly", "gst"];

export async function GET(req: Request) {
  const ctx = await getSession();
  if (!ctx || !ctx.session.twoFaVerified) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(ctx.actor.role, "finance:read")) return new Response("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const report = sp.get("report") as FinanceReport | null;
  const format = (sp.get("format") as ExportFormat | null) ?? "csv";
  if (!report || !REPORTS.includes(report)) return new Response("Unknown report", { status: 400 });
  if (format !== "csv" && format !== "pdf") return new Response("Unknown format", { status: 400 });

  const opt = <T,>(v: string | null): T | undefined => (v ? (v as T) : undefined);
  const statement: StatementFilters = {
    from: opt(sp.get("from")),
    to: opt(sp.get("to")),
    paymentType: opt<PaymentType>(sp.get("paymentType")),
    typeGroup: opt<"holding" | "followup">(sp.get("typeGroup")),
    program: opt<Program>(sp.get("program")),
    plan: opt<Plan>(sp.get("plan")),
    salespersonId: opt(sp.get("salespersonId")),
    search: opt(sp.get("search")),
  };
  const customers: CustomerFilters = {
    search: opt(sp.get("search")),
    program: opt<Program>(sp.get("program")),
    plan: opt<Plan>(sp.get("plan")),
    salespersonId: opt(sp.get("salespersonId")),
    paymentStatus: opt<"FULLY_PAID" | "PARTIAL" | "UNPAID">(sp.get("paymentStatus")),
    enrollmentStatus: opt(sp.get("enrollmentStatus")),
    from: opt(sp.get("from")),
    to: opt(sp.get("to")),
  };
  const year = sp.get("year") ? Number(sp.get("year")) : undefined;
  const month = sp.get("month") ? Number(sp.get("month")) : undefined;

  try {
    const result = await exportFinanceReport(ctx.actor, report, format, { statement, customers, year, month });
    const body = typeof result.body === "string" ? result.body : Buffer.from(result.body);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[finance export error]", e);
    return new Response("Unable to build the export.", { status: 500 });
  }
}
