/**
 * Client-safe formatters (no Prisma import, so they are safe in client components).
 * The canonical money type stays Prisma.Decimal in src/server/money, whose formatINR
 * delegates here for the Indian digit-grouping presentation (NFR-14).
 */

/** Format a numeric value as INR with Indian digit grouping: ₹1,24,999.00. */
export function formatINR(value: string | number): string {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim();
  const negative = raw.startsWith("-");
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [intRaw = "0", decRaw = ""] = cleaned.split(".");
  const intPart = intRaw.replace(/^0+(?=\d)/, "") || "0";
  const decPart = (decRaw + "00").slice(0, 2);

  let grouped: string;
  if (intPart.length <= 3) {
    grouped = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  }
  return `${negative ? "-" : ""}₹${grouped}.${decPart}`;
}

/** Format a date as DD-MMM-YYYY (NFR-14). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
