// ---------------------------------------------------------------------------
// DATE HELPERS
// Days are plain text like "2026-11-10" so they sort and compare easily.
// Etsy sends times as "seconds since 1970" (a Unix timestamp).
// ---------------------------------------------------------------------------

/** The shop owner's timezone. Days and weeks are counted in this timezone. */
export const DEFAULT_TIMEZONE = "Australia/Sydney";

/** Unix seconds -> "YYYY-MM-DD" in the given timezone. */
export function dayKey(tsSeconds: number, timeZone: string = DEFAULT_TIMEZONE): string {
  // The "en-CA" locale prints dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(tsSeconds * 1000));
}

/** Move a day forwards or backwards. addDays("2026-11-10", -1) -> "2026-11-09" */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b. daysBetween("2026-11-01", "2026-11-10") -> 9 */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** The Monday of the week that contains this day. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(day, -back);
}

/** Every day from `from` to `to`, both included. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** True if the text looks like a real "YYYY-MM-DD" day. */
export function isDay(text: unknown): text is string {
  return (
    typeof text === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    !Number.isNaN(Date.parse(`${text}T00:00:00Z`))
  );
}

/** "2026-11-10" -> "10 Nov" (short label for charts and lists). */
export function shortDay(day: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = day.split("-");
  return `${Number(d)} ${months[Number(m) - 1] ?? ""}`;
}
