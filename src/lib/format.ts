/**
 * Client-safe formatters (no Prisma import, so they are safe in client components).
 * The canonical money type stays Prisma.Decimal in src/server/money, whose formatINR
 * delegates here for the Indian digit-grouping presentation (NFR-14).
 *
 * Two families:
 *  - App display (NFR-14): formatINR "₹1,24,999.00", formatDate "DD-MMM-YYYY".
 *  - Payment-draft house style (ProITbridge's customer-facing WhatsApp message):
 *    formatDraftAmount "INR.84,999/-", formatDateLong "11th August 2026 (Tuesday)".
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Group an integer string with the Indian system: last 3 digits, then pairs. */
function groupIndian(intPart: string): string {
  const clean = intPart.replace(/^0+(?=\d)/, "") || "0";
  if (clean.length <= 3) return clean;
  const last3 = clean.slice(-3);
  const rest = clean.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

function splitAmount(value: string | number): { negative: boolean; intPart: string; decPart: string } {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim();
  const negative = raw.startsWith("-");
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const [intRaw = "0", decRaw = ""] = cleaned.split(".");
  return { negative, intPart: intRaw, decPart: (decRaw + "00").slice(0, 2) };
}

/** App display: ₹1,24,999.00 (NFR-14). */
export function formatINR(value: string | number): string {
  const { negative, intPart, decPart } = splitAmount(value);
  return `${negative ? "-" : ""}₹${groupIndian(intPart)}.${decPart}`;
}

/**
 * Payment-draft house style: INR.84,999/- (paise shown only when non-zero, e.g.
 * INR.44,999.50/-). Matches ProITbridge's real enrollment message.
 */
export function formatDraftAmount(value: string | number): string {
  const { negative, intPart, decPart } = splitAmount(value);
  const paise = decPart === "00" ? "" : `.${decPart}`;
  return `${negative ? "-" : ""}INR.${groupIndian(intPart)}${paise}/-`;
}

/** App display: DD-MMM-YYYY (NFR-14). */
export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Draft house style: "11th August 2026 (Tuesday)". */
export function formatDateLong(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${ordinal(d.getDate())} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()} (${WEEKDAYS[d.getDay()]})`;
}
