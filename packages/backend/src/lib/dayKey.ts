/**
 * Calendar-day keys in the learner's own timezone. The API's older day keys are
 * UTC, which puts an early-morning IST session on the previous day; the focus
 * plan (weekly target, gap detection) needs the learner's real calendar.
 */

/** "YYYY-MM-DD" for an instant, as seen in `timeZone`. */
export function dayKeyInTimeZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * The learner's timezone: the configured one, unless it is the default "UTC"
 * (nobody studies on UTC midnight), in which case the machine's own timezone.
 */
export function learnerTimeZone(configured?: string | null): string {
  if (configured && configured !== "UTC") return configured;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
