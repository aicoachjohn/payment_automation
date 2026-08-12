/**
 * Column definitions shared between the on-screen Finance tables and the CSV/Excel
 * exports. Defining them ONCE here is what guarantees the export column order matches
 * the screen exactly (FR-FIN-15, FR-FIN-08). Client-safe: only string formatters from
 * `@/lib/format`, no Prisma. Row TYPES are imported type-only (erased at build), so this
 * module never pulls the server-only finance service into a client bundle.
 */
import { formatINR, formatDate } from "@/lib/format";
import type { StatementRow, CustomerRow } from "@/server/services/finance";

export interface Column<T> {
  header: string;
  /** Cell value as a display string (used verbatim in CSV and on screen). */
  get: (row: T) => string;
}

const dash = (v: string | null | undefined): string => (v && v.length ? v : "—");

/** Daily/period statement columns (FR-FIN-03), in the exact on-screen order. */
export const STATEMENT_COLUMNS: Column<StatementRow>[] = [
  { header: "Learner Name", get: (r) => r.learnerName },
  { header: "Mobile", get: (r) => dash(r.mobile) },
  { header: "Email", get: (r) => dash(r.email) },
  { header: "Program", get: (r) => r.program },
  { header: "Plan", get: (r) => r.plan },
  { header: "Payment Type", get: (r) => r.paymentType },
  { header: "Payment #", get: (r) => String(r.paymentNumber) },
  { header: "Expected", get: (r) => formatINR(r.expectedAmount) },
  { header: "Received", get: (r) => formatINR(r.receivedAmount) },
  { header: "Payment Date", get: (r) => formatDate(r.paymentDate) },
  { header: "Method", get: (r) => r.paymentMethod },
  { header: "Transaction ID", get: (r) => r.transactionId },
  { header: "Total Received", get: (r) => formatINR(r.totalReceivedToDate) },
  { header: "Balance", get: (r) => formatINR(r.balance) },
  { header: "Salesperson", get: (r) => r.salesperson },
  { header: "Approved By", get: (r) => dash(r.approvedBy) },
  { header: "Approval Date", get: (r) => (r.approvedAt ? formatDate(r.approvedAt) : "—") },
  { header: "Commencing Date", get: (r) => (r.commencingDate ? formatDate(r.commencingDate) : "—") },
];

/** Customer master columns (FR-FIN-12), in the exact on-screen order. */
export const CUSTOMER_COLUMNS: Column<CustomerRow>[] = [
  { header: "Customer Name", get: (r) => r.customerName },
  { header: "Mobile", get: (r) => dash(r.mobile) },
  { header: "Email", get: (r) => dash(r.email) },
  { header: "Address", get: (r) => dash(r.address) },
  { header: "Date of Birth", get: (r) => (r.dob ? formatDate(r.dob) : "—") },
  { header: "Program", get: (r) => r.program },
  { header: "Plan", get: (r) => r.plan },
  { header: "Combo Mode", get: (r) => dash(r.comboMode) },
  { header: "Commencing Date", get: (r) => (r.commencingDate ? formatDate(r.commencingDate) : "—") },
  { header: "Standard Fee", get: (r) => (r.standardFee ? formatINR(r.standardFee) : "—") },
  { header: "Concession", get: (r) => formatINR(r.concession) },
  { header: "Final Approved Fee", get: (r) => (r.finalApprovedFee ? formatINR(r.finalApprovedFee) : "—") },
  { header: "Total Received", get: (r) => formatINR(r.totalReceived) },
  { header: "Balance", get: (r) => formatINR(r.balance) },
  { header: "Payment Status", get: (r) => r.paymentStatus },
  { header: "Enrollment Status", get: (r) => r.enrollmentStatus },
  { header: "Salesperson", get: (r) => r.salesperson },
  { header: "Enrollment Date", get: (r) => formatDate(r.enrollmentDate) },
];

/** Outstanding balance report columns (FR-FIN-22). */
export const OUTSTANDING_COLUMNS: Column<{
  learnerName: string;
  mobile: string | null;
  program: string;
  plan: string;
  finalApprovedFee: string;
  totalReceived: string;
  outstanding: string;
  paymentStage: string;
  daysOutstanding: number;
  salesperson: string;
}>[] = [
  { header: "Learner Name", get: (r) => r.learnerName },
  { header: "Mobile", get: (r) => dash(r.mobile) },
  { header: "Program", get: (r) => r.program },
  { header: "Plan", get: (r) => r.plan },
  { header: "Final Approved Fee", get: (r) => formatINR(r.finalApprovedFee) },
  { header: "Total Received", get: (r) => formatINR(r.totalReceived) },
  { header: "Outstanding", get: (r) => formatINR(r.outstanding) },
  { header: "Payment Stage", get: (r) => r.paymentStage },
  { header: "Days Outstanding", get: (r) => String(r.daysOutstanding) },
  { header: "Salesperson", get: (r) => r.salesperson },
];
