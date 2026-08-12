/**
 * IST deadline arithmetic (Phase 10, FR-SAL-49..53). Pure boundary tests: "End of Day 15"
 * is 23:59:59.999 IST on the fifteenth day after the Course Starting Amount was approved.
 */
import { describe, expect, it } from "vitest";
import { istDayStartUtc, istDateKey, daysSinceIst, downPaymentDeadline, IST_OFFSET_MS } from "@/lib/ist";

const DAY = 86_400_000;

describe("istDayStartUtc — 00:00 IST of the containing IST day", () => {
  it("maps a mid-day-IST instant to that IST midnight (in UTC)", () => {
    // 2026-05-10 10:00 IST == 2026-05-10 04:30 UTC.
    const instant = new Date("2026-05-10T04:30:00.000Z");
    const start = istDayStartUtc(instant);
    // IST midnight 2026-05-10 == 2026-05-09 18:30 UTC.
    expect(start.toISOString()).toBe("2026-05-09T18:30:00.000Z");
  });

  it("a UTC instant just after IST midnight stays on the same IST day", () => {
    const justAfter = new Date("2026-05-09T18:30:00.500Z"); // 00:00:00.5 IST on the 10th
    expect(istDateKey(justAfter)).toBe("2026-05-10");
  });

  it("a UTC instant just before IST midnight is the previous IST day", () => {
    const justBefore = new Date("2026-05-09T18:29:59.500Z"); // 23:59:59.5 IST on the 9th
    expect(istDateKey(justBefore)).toBe("2026-05-09");
  });
});

describe("daysSinceIst — whole IST days, Day 0 = approval day", () => {
  const anchor = new Date("2026-05-10T04:30:00.000Z"); // 10:00 IST, Day 0
  it("same day → 0", () => expect(daysSinceIst(anchor, anchor)).toBe(0));
  it("3 IST days later (any time of that day) → 3", () => {
    expect(daysSinceIst(anchor, new Date(anchor.getTime() + 3 * DAY))).toBe(3);
    expect(daysSinceIst(anchor, new Date(istDayStartUtc(anchor).getTime() + 3 * DAY + 60_000))).toBe(3);
  });
  it("15 IST days later → 15", () => {
    expect(daysSinceIst(anchor, new Date(istDayStartUtc(anchor).getTime() + 15 * DAY + 10 * 3_600_000))).toBe(15);
  });
});

describe("downPaymentDeadline — end of Day 15 (23:59:59.999 IST)", () => {
  const anchor = new Date("2026-05-10T04:30:00.000Z"); // Day 0
  const deadline = downPaymentDeadline(anchor, 15);

  it("is 23:59:59.999 IST on Day 15", () => {
    // Day 15 IST start = anchorISTmidnight + 15 days; end = +1 day - 1ms.
    const day15StartUtc = istDayStartUtc(anchor).getTime() + 15 * DAY;
    expect(deadline.getTime()).toBe(day15StartUtc + DAY - 1);
    // Sanity: local IST clock reads 23:59:59.999.
    const istClock = new Date(deadline.getTime() + IST_OFFSET_MS);
    expect(istClock.getUTCHours()).toBe(23);
    expect(istClock.getUTCMinutes()).toBe(59);
    expect(istClock.getUTCSeconds()).toBe(59);
  });

  it("23:55 IST on Day 15 is BEFORE the deadline (on time)", () => {
    const at2355Day15 = new Date(deadline.getTime() - 5 * 60_000);
    expect(at2355Day15.getTime()).toBeLessThan(deadline.getTime());
  });

  it("00:05 IST on Day 16 is AFTER the deadline (overdue)", () => {
    const at0005Day16 = new Date(istDayStartUtc(anchor).getTime() + 16 * DAY + 5 * 60_000);
    expect(at0005Day16.getTime()).toBeGreaterThan(deadline.getTime());
  });
});
