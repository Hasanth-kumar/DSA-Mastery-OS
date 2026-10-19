import { describe, expect, it } from "vitest";
import { latestSessions } from "./sessions.js";

const s = (day: number, score: number) => ({
  date: new Date(Date.UTC(2026, 9, day)),
  problemsSolved: 1,
  productivityScore: score,
  duration: 30,
});

describe("latestSessions", () => {
  it("returns the newest sessions whatever the input order", () => {
    const asc = [s(1, 10), s(2, 20), s(3, 30), s(4, 40)];
    const desc = [...asc].reverse();
    expect(latestSessions(asc, 2).map((x) => x.productivityScore)).toEqual([40, 30]);
    expect(latestSessions(desc, 2).map((x) => x.productivityScore)).toEqual([40, 30]);
  });
});
