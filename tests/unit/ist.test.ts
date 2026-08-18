/**
 * IST deadline arithmetic (Phase 10, FR-SAL-49..53). Pure boundary tests: "End of Day 15"
 * is 23:59:59.999 IST on the fifteenth day after the Course Starting Amount was approved.
 */
import { describe, expect, it } from "vitest";
import { istDayStartUtc, istNextDayBoundary, istDateKey, daysSinceIst, downPaymentDeadline, IST_OFFSET_MS } from "@/lib/ist";

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

describe("istNextDayBoundary — when the working day ends for 2FA trust", () => {
  // 2FA trust hangs off this. It must (a) survive a late evening in one piece and
  // (b) always lapse before the next working morning. IST is UTC+5:30, so an 04:00 IST
  // boundary is 22:30 UTC the previous date.
  const CUTOFF = 4;

  it("a daytime sign-in runs to 04:00 IST the NEXT day", () => {
    // 2026-08-18 09:00 IST == 2026-08-18 03:30 UTC.
    const end = istNextDayBoundary(new Date("2026-08-18T03:30:00.000Z"), CUTOFF);
    // 04:00 IST on the 19th == 22:30 UTC on the 18th.
    expect(end.toISOString()).toBe("2026-08-18T22:30:00.000Z");
  });

  it("a late-evening sign-in is NOT cut off at midnight — the whole point of the cutoff", () => {
    // 2026-08-18 22:00 IST == 2026-08-18 16:30 UTC.
    const end = istNextDayBoundary(new Date("2026-08-18T16:30:00.000Z"), CUTOFF);
    expect(end.toISOString()).toBe("2026-08-18T22:30:00.000Z"); // 04:00 IST on the 19th
    expect(end.getTime()).toBeGreaterThan(new Date("2026-08-18T18:30:00.000Z").getTime()); // past IST midnight
  });

  it("just past midnight still belongs to the evening that is finishing", () => {
    // 2026-08-19 01:00 IST == 2026-08-18 19:30 UTC.
    const end = istNextDayBoundary(new Date("2026-08-18T19:30:00.000Z"), CUTOFF);
    expect(end.toISOString()).toBe("2026-08-18T22:30:00.000Z"); // same 04:00 IST boundary
  });

  it("after the cutoff, the next morning gets a fresh full day", () => {
    // 2026-08-19 05:00 IST == 2026-08-18 23:30 UTC — past the 04:00 boundary.
    const end = istNextDayBoundary(new Date("2026-08-18T23:30:00.000Z"), CUTOFF);
    expect(end.toISOString()).toBe("2026-08-19T22:30:00.000Z"); // 04:00 IST on the 20th
  });

  it("landing exactly on the boundary starts a new day rather than expiring instantly", () => {
    const boundary = new Date("2026-08-18T22:30:00.000Z"); // exactly 04:00 IST on the 19th
    expect(istNextDayBoundary(boundary, CUTOFF).toISOString()).toBe("2026-08-19T22:30:00.000Z");
  });

  it("a 9am sign-in always expires before the following 9am, so mornings are challenged", () => {
    const nineAm = new Date("2026-08-18T03:30:00.000Z");
    const nextNineAm = new Date(nineAm.getTime() + DAY);
    expect(istNextDayBoundary(nineAm, CUTOFF).getTime()).toBeLessThan(nextNineAm.getTime());
  });

  it("cutoff 0 gives the plain midnight boundary", () => {
    // 2026-08-18 09:00 IST → 00:00 IST on the 19th == 18:30 UTC on the 18th.
    expect(istNextDayBoundary(new Date("2026-08-18T03:30:00.000Z"), 0).toISOString())
      .toBe("2026-08-18T18:30:00.000Z");
  });

  it("clamps a nonsense cutoff instead of drifting into another day", () => {
    const t = new Date("2026-08-18T03:30:00.000Z");
    expect(istNextDayBoundary(t, 99).toISOString()).toBe(istNextDayBoundary(t, 23).toISOString());
    expect(istNextDayBoundary(t, -5).toISOString()).toBe(istNextDayBoundary(t, 0).toISOString());
  });
});
