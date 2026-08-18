/**
 * Pure IST (UTC+5:30) date arithmetic for the 15-day rule (FR-SAL-49..53). No DB, no
 * server-only import, so it is unit-testable and safe anywhere. "End of Day 15" is
 * 23:59:59.999 IST on the fifteenth day after the Course Starting Amount was approved.
 */
export const IST_OFFSET_MS = 330 * 60_000; // +05:30
const DAY_MS = 86_400_000;

/** UTC instant of 00:00:00 IST for the IST calendar day containing `d`. */
export function istDayStartUtc(d: Date): Date {
  const shifted = d.getTime() + IST_OFFSET_MS;
  const dayFloor = Math.floor(shifted / DAY_MS) * DAY_MS;
  return new Date(dayFloor - IST_OFFSET_MS);
}

/**
 * UTC instant of 23:59:59.999 IST on the IST calendar day containing `d` — the last moment
 * of "today" for a user in India. Used for trust that must end with the working day instead
 * of rolling a fixed number of hours into the next morning.
 */
export function istEndOfDay(d: Date): Date {
  return new Date(istDayStartUtc(d).getTime() + DAY_MS - 1);
}

/** `YYYY-MM-DD` of the IST calendar day (used in job idempotency keys). */
export function istDateKey(d: Date): string {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
}

/** Whole IST days from `anchor`'s day to `now`'s day (Day 0 = the approval day). */
export function daysSinceIst(anchor: Date, now: Date): number {
  return Math.round((istDayStartUtc(now).getTime() - istDayStartUtc(anchor).getTime()) / DAY_MS);
}

/** End-of-Day-N (23:59:59.999 IST) after the approval day. windowDays=15 → end of Day 15. */
export function downPaymentDeadline(anchor: Date, windowDays: number): Date {
  return new Date(istDayStartUtc(anchor).getTime() + (windowDays + 1) * DAY_MS - 1);
}
