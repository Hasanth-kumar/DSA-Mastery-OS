import { describe, expect, it } from "vitest";
import { evaluatePinExpiry, PIN_MAX_AGE_DAYS } from "./pin-expiry.js";

const DAY = 86_400_000;
const now = Date.parse("2026-10-24T12:00:00Z");

describe("evaluatePinExpiry (P3.3)", () => {
  it("keeps a fresh pin and reports when it ends", () => {
    expect(
      evaluatePinExpiry({ pinnedAt: now - DAY, counts: { total: 10, unsolved: 4 }, now }),
    ).toEqual({ expired: false, expiresAt: now - DAY + PIN_MAX_AGE_DAYS * DAY });
  });

  it("expires exactly at 7 days, not before", () => {
    const pinnedAt = now - 7 * DAY;
    expect(evaluatePinExpiry({ pinnedAt: pinnedAt + 1, counts: { total: 10, unsolved: 4 }, now }).expired).toBe(false);
    expect(evaluatePinExpiry({ pinnedAt, counts: { total: 10, unsolved: 4 }, now })).toEqual({
      expired: true,
      reason: "max-age",
    });
  });

  it("expires as soon as the pinned topic's first pass is complete", () => {
    expect(evaluatePinExpiry({ pinnedAt: now, counts: { total: 6, unsolved: 0 }, now })).toEqual({
      expired: true,
      reason: "first-pass-complete",
    });
  });

  it("first-pass completion wins even without a pin date", () => {
    expect(evaluatePinExpiry({ pinnedAt: null, counts: { total: 3, unsolved: 0 }, now })).toEqual({
      expired: true,
      reason: "first-pass-complete",
    });
  });

  it("does not treat a topic with no problems as complete", () => {
    expect(evaluatePinExpiry({ pinnedAt: now, counts: { total: 0, unsolved: 0 }, now }).expired).toBe(false);
    expect(evaluatePinExpiry({ pinnedAt: now, counts: undefined, now }).expired).toBe(false);
  });

  it("a legacy pin with no date does not expire on age until a clock is started", () => {
    expect(evaluatePinExpiry({ pinnedAt: null, counts: { total: 10, unsolved: 4 }, now })).toEqual({
      expired: false,
      expiresAt: null,
    });
  });
});
