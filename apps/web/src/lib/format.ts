/** Display helpers. Money is displayed from integer cents without floating-point arithmetic. */

export function formatUsd(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  return frac === 0 ? `$${whole}` : `$${whole}.${frac.toString().padStart(2, '0')}`;
}

/** "Saturday, 5 December 2026" for a YYYY-MM-DD date (no timezone shifting: it is a calendar date). */
export function formatCalendarDate(isoDate: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "in 3 days", "in 5 hours", "in 12 minutes", or "now". */
export function untilLabel(targetIso: string, now: Date = new Date()): string {
  const ms = Date.parse(targetIso) - now.getTime();
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${plural(Math.max(1, mins), 'minute')}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${plural(hours, 'hour')}`;
  return `in ${plural(Math.round(hours / 24), 'day')}`;
}

/** Last N characters of an address, to help a person confirm it is the one they registered. */
export function addressTail(address: string, n = 6): string {
  return `…${address.slice(-n)}`;
}

export function addressPreview(address: string): string {
  return address.length <= 20 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function localDateInputValue(d = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDaysToInput(value: string, days: number): string {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
