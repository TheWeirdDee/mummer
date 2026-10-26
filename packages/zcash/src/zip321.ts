import { base64urlnopad } from '@scure/base';
import { AmountError, formatZec, parseZec } from './amount.js';
import { MEMO_MAX_BYTES } from './memo.js';

/**
 * ZIP 321 payment request URIs: a strict builder and a strict parser.
 *
 * Mummer only BUILDS single-recipient requests (Zodl iOS 3.7.2+ rejects
 * multi-recipient QR codes). The parser accepts the full grammar (multiple
 * payments, indices, unknown parameters) so it can be tested against the
 * ZIP's own valid/invalid examples and so that every URI Mummer shows can be
 * re-parsed and compared field-for-field before display.
 *
 * Custom assets (`req-asset`) are intentionally unsupported: the ZIP requires
 * a parser that does not understand a `req-` parameter to reject the URI.
 */

export class Zip321Error extends Error {}

export interface Payment {
  address: string;
  amountZat?: bigint;
  memo?: Uint8Array;
  label?: string;
  message?: string;
}

export interface BuildInput {
  address: string;
  amountZat: bigint;
  memo?: string | Uint8Array;
  label?: string;
  message?: string;
}

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** Percent-encode everything except RFC 3986 unreserved characters (always valid as a qchar). */
function pctEncode(s: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && UNRESERVED.test(ch) ? ch : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export function buildPaymentRequest(input: BuildInput): string {
  if (!/^[A-Za-z0-9]+$/.test(input.address)) throw new Zip321Error('Invalid address characters');
  if (input.amountZat <= 0n) throw new Zip321Error('Amount must be greater than zero');
  const params: string[] = [`amount=${formatZec(input.amountZat)}`];
  if (input.memo !== undefined) {
    const bytes = typeof input.memo === 'string' ? new TextEncoder().encode(input.memo) : input.memo;
    if (bytes.length > MEMO_MAX_BYTES) throw new Zip321Error('Memo exceeds 512 bytes');
    if (bytes.length > 0) params.push(`memo=${base64urlnopad.encode(bytes)}`);
  }
  if (input.label) params.push(`label=${pctEncode(input.label)}`);
  if (input.message) params.push(`message=${pctEncode(input.message)}`);
  return `zcash:${input.address}?${params.join('&')}`;
}

const NAME_RE = /^([A-Za-z][A-Za-z0-9+-]*)(?:\.([1-9][0-9]{0,3}))?$/;
const QVALUE_RE = /^(?:[A-Za-z0-9\-._~!$'()*+,;:@]|%[0-9A-Fa-f]{2})*$/;
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

function qdecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    throw new Zip321Error('Invalid percent-encoding');
  }
}

export interface ParseOptions {
  /** Return true if the address is transparent (a memo paired with one invalidates the URI). */
  isTransparent?: (address: string) => boolean;
}

/** Parse a ZIP 321 URI. Throws Zip321Error for anything the grammar or the ZIP's MUST rules forbid. Returns payments ordered by index. */
export function parsePaymentRequest(uri: string, opts: ParseOptions = {}): Payment[] {
  if (!uri.startsWith('zcash:')) throw new Zip321Error('Not a zcash: URI');
  const rest = uri.slice('zcash:'.length);
  const q = rest.indexOf('?');
  const hier = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? undefined : rest.slice(q + 1);

  if (hier.length === 0 && query === undefined) throw new Zip321Error('Missing address');
  if (hier.length > 0 && !/^[A-Za-z0-9]+$/.test(hier)) throw new Zip321Error('Invalid address in URI path');

  type Slot = { address?: string; amount?: string; memo?: string; label?: string; message?: string; touched: boolean };
  const slots = new Map<string, Slot>();
  const slot = (idx: string): Slot => {
    let s = slots.get(idx);
    if (!s) slots.set(idx, (s = { touched: false }));
    return s;
  };
  if (hier.length > 0) slot('').address = hier;

  const set = (idx: string, key: 'address' | 'amount' | 'memo' | 'label' | 'message', value: string) => {
    const s = slot(idx);
    if (s[key] !== undefined) throw new Zip321Error(`Duplicate ${key} parameter`);
    s[key] = value;
    if (key !== 'address') s.touched = true;
  };

  if (query !== undefined) {
    for (const raw of query.split('&')) {
      if (raw.length === 0) continue;
      const eq = raw.indexOf('=');
      const nameIdx = eq === -1 ? raw : raw.slice(0, eq);
      const value = eq === -1 ? undefined : raw.slice(eq + 1);
      const m = NAME_RE.exec(nameIdx);
      if (!m) throw new Zip321Error('Invalid parameter name');
      // ABNF quoted strings are case-insensitive, so 'AMOUNT' and 'Req-asset' are the known names too.
      const name = m[1]!.toLowerCase();
      const idx = m[2] ?? '';

      switch (name) {
        case 'address':
          if (value === undefined || !/^[A-Za-z0-9]+$/.test(value)) throw new Zip321Error('Invalid address parameter');
          set(idx, 'address', value);
          break;
        case 'amount':
          if (value === undefined || !/^[0-9]+(?:\.[0-9]{1,8})?$/.test(value)) throw new Zip321Error('Invalid amount');
          set(idx, 'amount', value);
          break;
        case 'memo':
          if (value === undefined || !B64URL_RE.test(value)) throw new Zip321Error('Memo is not base64url');
          set(idx, 'memo', value);
          break;
        case 'label':
        case 'message':
          if (value === undefined || !QVALUE_RE.test(value)) throw new Zip321Error(`Invalid ${name}`);
          set(idx, name, value);
          break;
        default:
          if (name === 'req-asset' || name.startsWith('req-')) {
            throw new Zip321Error(`Unsupported required parameter: ${name}`);
          }
          if (value !== undefined && !QVALUE_RE.test(value)) throw new Zip321Error('Invalid parameter value');
          slot(idx).touched = true; // other params still require an address at the same index
      }
    }
  }

  const out: [number, Payment][] = [];
  for (const [idx, s] of slots) {
    if (s.address === undefined) {
      if (s.touched) throw new Zip321Error(`Parameters at index "${idx}" have no address`);
      continue;
    }
    const p: Payment = { address: s.address };
    try {
      if (s.amount !== undefined) p.amountZat = parseZec(s.amount);
    } catch (e) {
      if (e instanceof AmountError) throw new Zip321Error(e.message);
      throw e;
    }
    if (s.memo !== undefined) {
      let bytes: Uint8Array;
      try {
        bytes = base64urlnopad.decode(s.memo);
      } catch {
        throw new Zip321Error('Memo is not valid base64url');
      }
      if (bytes.length > MEMO_MAX_BYTES) throw new Zip321Error('Memo exceeds 512 bytes');
      if (opts.isTransparent?.(s.address)) throw new Zip321Error('A memo cannot be paired with a transparent address');
      p.memo = bytes;
    }
    if (s.label !== undefined) p.label = qdecode(s.label);
    if (s.message !== undefined) p.message = qdecode(s.message);
    out.push([idx === '' ? 0 : Number(idx), p]);
  }
  if (out.length === 0) throw new Zip321Error('No payments in URI');
  out.sort((a, b) => a[0] - b[0]);
  return out.map(([, p]) => p);
}

export interface Expected {
  address: string;
  amountZat: bigint;
  memo: string;
}

/**
 * Re-parse a URI and confirm that it requests exactly one payment with the
 * expected address, amount and memo bytes. Guards against address
 * substitution and any builder bug before a QR is shown.
 */
export function verifyPaymentRequest(uri: string, expected: Expected): void {
  const payments = parsePaymentRequest(uri);
  if (payments.length !== 1) throw new Zip321Error('Request must contain exactly one payment');
  const p = payments[0]!;
  if (p.address !== expected.address) throw new Zip321Error('Request address does not match the intended recipient');
  if (p.amountZat !== expected.amountZat) throw new Zip321Error('Request amount does not match the quoted amount');
  const want = new TextEncoder().encode(expected.memo);
  if (!p.memo || p.memo.length !== want.length || p.memo.some((b, i) => b !== want[i])) {
    throw new Zip321Error('Request memo does not match the intended memo');
  }
}
