/**
 * Date handling for group deadlines. Dates are plain `YYYY-MM-DD` strings
 * interpreted in the group's IANA timezone; instants are computed with Intl so
 * DST and half-hour offsets are handled by the platform's tz database.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function parseDate(s: string): { y: number; m: number; d: number } | undefined {
  const m = DATE_RE.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return { y, m: mo, d };
}

export function isValidDate(s: string): boolean {
  return parseDate(s) !== undefined;
}

/** Offset of `tz` from UTC in milliseconds at the given instant (positive east of UTC). */
function tzOffsetMs(tz: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The UTC instant at which local midnight (00:00:00) of `date` occurs in `tz`. */
export function localMidnightUtc(date: string, tz: string): Date {
  const p = parseDate(date);
  if (!p) throw new RangeError('Invalid date');
  if (!isValidTimezone(tz)) throw new RangeError('Invalid timezone');
  const guess = Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0);
  const off1 = tzOffsetMs(tz, guess);
  let t = guess - off1;
  const off2 = tzOffsetMs(tz, t);
  if (off2 !== off1) t = guess - off2;
  // If local midnight falls in a DST gap, the instant above maps to 01:00 local; step back to the gap start.
  const back = tzOffsetMs(tz, t - 1);
  if (back !== tzOffsetMs(tz, t) && localDateOf(t, tz) === date && localHour(t, tz) !== 0) {
    t = t - (tzOffsetMs(tz, t) - back);
  }
  return new Date(t);
}

function localDateOf(instantMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instantMs));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function localHour(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit' }).formatToParts(new Date(instantMs));
  return Number(parts.find((p) => p.type === 'hour')!.value);
}

export function addDays(date: string, days: number): string {
  const p = parseDate(date);
  if (!p) throw new RangeError('Invalid date');
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return d.toISOString().slice(0, 10);
}

/** Local calendar date in `tz` for a given instant. */
export function todayIn(tz: string, now: Date): string {
  return localDateOf(now.getTime(), tz);
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  if (!pa || !pb) throw new RangeError('Invalid date');
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/**
 * Instant at which joining closes: the start of the day AFTER the deadline
 * date in the group's timezone (so the deadline day itself is fully open).
 */
export function joinClosesAt(joinDeadline: string, tz: string): Date {
  return localMidnightUtc(addDays(joinDeadline, 1), tz);
}

/** Instant at which the reveal opens: midnight at the start of the reveal date in the group's timezone. */
export function revealOpensAt(revealDate: string, tz: string): Date {
  return localMidnightUtc(revealDate, tz);
}

/** Coarse (UTC day) bucket used for stored timestamps, so row times cannot be used to correlate actions. */
export function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}
