import { bech32, bech32m, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { f4jumbleInv, F4_MIN_LEN } from './f4jumble.js';

/**
 * Zcash address decoding and gift-recipient validation (mainnet only).
 *
 * Implements ZIP 316 (Unified Addresses, Revision 0 and Revision 2) on top of
 * audited primitives (@scure/base bech32m, @noble/hashes BLAKE2b). No Zcash
 * keys are ever derived or handled; this module only parses public receivers.
 *
 * Limits (documented in docs/KNOWN_LIMITATIONS.md): receivers are validated
 * structurally (checksum, length, ordering, typecodes). We do not verify that
 * receiver bytes are valid curve points; a wallet performs that check at send
 * time and a bad receiver would fail there rather than lose funds silently.
 */

export type RejectCode =
  | 'empty'
  | 'whitespace'
  | 'too_long'
  | 'transparent'
  | 'tex'
  | 'sprout'
  | 'testnet'
  | 'unknown_format'
  | 'bad_checksum'
  | 'bad_encoding'
  | 'no_shielded_receiver'
  | 'unsupported_receivers'
  | 'expired'
  | 'sapling_bad_length';

export type AddressKind = 'unified' | 'sapling';

export interface UnifiedParts {
  revision: 0 | 2;
  orchard?: Uint8Array;
  sapling?: Uint8Array;
  p2pkh?: Uint8Array;
  p2sh?: Uint8Array;
  expiryHeight?: number;
  /** Seconds since the Unix epoch. */
  expiryTime?: number;
  /** Typecodes of ignorable unknown receivers or metadata items that were skipped. */
  ignoredTypecodes: number[];
}

export interface GiftAddressOk {
  ok: true;
  kind: AddressKind;
  /** Canonical string (trimmed, as supplied; Zcash addresses are case-sensitive in practice only via bech32 rules). */
  address: string;
  hasOrchard: boolean;
  hasSapling: boolean;
  hasTransparent: boolean;
  warnings: AddressWarning[];
}

export type AddressWarning = 'contains_transparent_receiver' | 'has_expiry_height';

export interface GiftAddressErr {
  ok: false;
  code: RejectCode;
  /** Plain-language reason, safe to show in UI. */
  message: string;
}

export type GiftAddressResult = GiftAddressOk | GiftAddressErr;

const MAX_ADDRESS_LENGTH = 1000;
const b58c = createBase58check(sha256);

const MAINNET_UA_HRP = new Map<string, 0 | 2>([
  ['u', 0],
  ['zu', 2],
  ['tu', 2],
]);
const TESTNET_UA_HRPS = new Set(['utest', 'zutest', 'tutest', 'uregtest', 'zuregtest', 'turegtest']);

const TC_P2PKH = 0x00;
const TC_P2SH = 0x01;
const TC_SAPLING = 0x02;
const TC_ORCHARD = 0x03;
const TC_EXPIRY_HEIGHT = 0xe0;
const TC_EXPIRY_TIME = 0xe1;

class Reject extends Error {
  constructor(
    readonly code: RejectCode,
    message: string,
  ) {
    super(message);
  }
}

function readCompactSize(buf: Uint8Array, pos: number): [number, number] {
  const first = buf[pos];
  if (first === undefined) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  if (first < 0xfd) return [first, pos + 1];
  const size = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
  if (pos + 1 + size > buf.length) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  let v = 0n;
  for (let i = size - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[pos + 1 + i]!);
  // Canonical encoding is required (no padding of small values).
  const min = first === 0xfd ? 0xfdn : first === 0xfe ? 0x10000n : 0x100000000n;
  if (v < min) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  return [Number(v), pos + 1 + size];
}

function leToBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
  return v;
}

/**
 * Parse a ZIP 316 Unified Address (Revision 0 or 2). Throws Reject on any
 * violation of the consumer rules in the ZIP.
 */
export function decodeUnifiedAddress(addr: string): UnifiedParts & { hrp: string } {
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32m.decodeUnsafe(addr, false) ?? (undefined as never);
  } catch {
    decoded = undefined as never;
  }
  if (!decoded) {
    // Distinguish a checksum failure from other malformations for friendlier messages.
    throw new Reject('bad_checksum', 'This address has a typo. Copy it again from your wallet.');
  }
  const hrp = decoded.prefix;
  const revision = MAINNET_UA_HRP.get(hrp);
  if (revision === undefined) {
    if (TESTNET_UA_HRPS.has(hrp)) throw new Reject('testnet', 'This is a testnet address. Mummer works with mainnet addresses only.');
    throw new Reject('unknown_format', 'This is not a Zcash unified address.');
  }

  const jumbled = Uint8Array.from(bech32m.fromWords(decoded.words));
  if (jumbled.length < F4_MIN_LEN) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  const raw = f4jumbleInv(jumbled);

  // The final 16 bytes must be the HRP zero-padded to 16 bytes.
  const hrpBytes = new TextEncoder().encode(hrp);
  const tail = raw.subarray(raw.length - 16);
  const expectedTail = new Uint8Array(16);
  expectedTail.set(hrpBytes);
  for (let i = 0; i < 16; i++) {
    if (tail[i] !== expectedTail[i]) throw new Reject('bad_checksum', 'This address has a typo. Copy it again from your wallet.');
  }
  const body = raw.subarray(0, raw.length - 16);

  const parts: UnifiedParts & { hrp: string } = { hrp, revision, ignoredTypecodes: [] };
  let pos = 0;
  let prevTypecode = -1;
  let items = 0;
  let nonMetadataItems = 0;

  while (pos < body.length) {
    let typecode: number;
    let len: number;
    [typecode, pos] = readCompactSize(body, pos);
    [len, pos] = readCompactSize(body, pos);
    if (pos + len > body.length) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
    const data = body.subarray(pos, pos + len);
    pos += len;
    items++;

    // Ascending order also forbids repeated typecodes.
    if (typecode <= prevTypecode) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
    prevTypecode = typecode;

    switch (typecode) {
      case TC_P2PKH:
        if (len !== 20) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
        parts.p2pkh = Uint8Array.from(data);
        nonMetadataItems++;
        break;
      case TC_P2SH:
        if (len !== 20) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
        parts.p2sh = Uint8Array.from(data);
        nonMetadataItems++;
        break;
      case TC_SAPLING:
        if (len !== 43) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
        parts.sapling = Uint8Array.from(data);
        nonMetadataItems++;
        break;
      case TC_ORCHARD:
        if (len !== 43) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
        parts.orchard = Uint8Array.from(data);
        nonMetadataItems++;
        break;
      case TC_EXPIRY_HEIGHT:
        if (revision !== 2) throw new Reject('unsupported_receivers', 'This address uses metadata that is not valid for its version.');
        if (len !== 4) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
        parts.expiryHeight = Number(leToBigInt(data));
        break;
      case TC_EXPIRY_TIME:
        if (revision !== 2) throw new Reject('unsupported_receivers', 'This address uses metadata that is not valid for its version.');
        if (len !== 8) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
        parts.expiryTime = Number(leToBigInt(data));
        break;
      default:
        if (typecode >= 0xe0 && typecode <= 0xfc) {
          // Unrecognised MUST-understand metadata: consumers MUST reject.
          throw new Reject('unsupported_receivers', 'This address needs a newer wallet feature that Mummer does not understand.');
        }
        if (typecode >= 0xc0 && typecode <= 0xdf) {
          // Unrecognised ignorable metadata (Revision 0 forbids MUST-understand only).
          parts.ignoredTypecodes.push(typecode);
        } else if (typecode >= 0xfffa) {
          // Experimental range: not understood, ignore.
          parts.ignoredTypecodes.push(typecode);
          nonMetadataItems++;
        } else {
          // Unassigned receiver typecode: consumers ignore receivers they do not know.
          parts.ignoredTypecodes.push(typecode);
          nonMetadataItems++;
        }
    }
  }

  if (items === 0 || nonMetadataItems === 0) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  if (parts.p2pkh && parts.p2sh) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  const hasShielded = !!parts.orchard || !!parts.sapling;
  if (revision === 0 && !hasShielded) throw new Reject('no_shielded_receiver', 'This address has no shielded receiver.');
  if (hrp === 'zu' && (parts.p2pkh || parts.p2sh)) throw new Reject('bad_encoding', 'This address looks damaged. Copy it again from your wallet.');
  return parts;
}

function decodeSapling(addr: string): Uint8Array {
  let decoded: { prefix: string; words: number[] } | undefined;
  try {
    decoded = bech32.decodeUnsafe(addr, false) ?? undefined;
  } catch {
    decoded = undefined;
  }
  if (!decoded) throw new Reject('bad_checksum', 'This address has a typo. Copy it again from your wallet.');
  if (decoded.prefix === 'ztestsapling') throw new Reject('testnet', 'This is a testnet address. Mummer works with mainnet addresses only.');
  if (decoded.prefix !== 'zs') throw new Reject('unknown_format', 'This is not a Zcash shielded address.');
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  if (bytes.length !== 43) throw new Reject('sapling_bad_length', 'This address looks damaged. Copy it again from your wallet.');
  return bytes;
}

const TRANSPARENT_PREFIX_MAINNET = new Map<string, string>([
  ['1cb8', 'transparent'], // t1...
  ['1cbd', 'transparent'], // t3...
]);

function tryTransparent(addr: string): GiftAddressErr | undefined {
  if (!/^t[1-9A-HJ-NP-Za-km-z]{30,40}$/.test(addr)) return undefined;
  try {
    const bytes = b58c.decode(addr);
    const prefix = Array.from(bytes.subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join('');
    if (TRANSPARENT_PREFIX_MAINNET.has(prefix)) {
      return {
        ok: false,
        code: 'transparent',
        message: 'This is a transparent address (it starts with t). Gifts must go to a shielded address so the payment stays private.',
      };
    }
    return { ok: false, code: 'testnet', message: 'This is a testnet address. Mummer works with mainnet addresses only.' };
  } catch {
    return { ok: false, code: 'bad_checksum', message: 'This address has a typo. Copy it again from your wallet.' };
  }
}

function fail(code: RejectCode, message: string): GiftAddressErr {
  return { ok: false, code, message };
}

/**
 * Validate an address for use as a gift recipient.
 *
 * Accepted: mainnet Unified Addresses (Rev 0 `u1…`, Rev 2 `zu1…` / `tu1…`)
 * containing an Orchard and/or Sapling receiver, and mainnet Sapling `zs1…`.
 * Rejected, with a reason: transparent (t1/t3), TEX (tex1), Sprout (zc…),
 * testnet, unified addresses with no shielded receiver, and anything
 * malformed.
 *
 * `nowSeconds` is injectable for tests; an expired Rev 2 address is rejected.
 */
export function validateGiftAddress(input: string, nowSeconds: number = Math.floor(Date.now() / 1000)): GiftAddressResult {
  if (typeof input !== 'string' || input.length === 0) return fail('empty', 'Paste your shielded Zcash address.');
  if (input !== input.trim() || /\s/.test(input)) return fail('whitespace', 'Remove spaces or line breaks from the address.');
  if (input.length > MAX_ADDRESS_LENGTH) return fail('too_long', 'This is too long to be a Zcash address.');

  const lower = input.toLowerCase();
  const upper = input.toUpperCase();

  // TEX (bech32m, transparent-source) must be recognised before base58 transparent checks.
  if (lower.startsWith('tex1') || lower.startsWith('textest1')) {
    return fail('tex', 'This is a transparent-source (TEX) address. Gifts must go to a shielded address.');
  }
  const t = tryTransparent(input);
  if (t) return t;
  if (/^zc[1-9A-HJ-NP-Za-km-z]{90,100}$/.test(input)) {
    return fail('sprout', 'This is an old Sprout address, which Mummer cannot pay. Use a Unified or Sapling address from your wallet.');
  }

  const looksSapling = lower.startsWith('zs1') || lower.startsWith('ztestsapling1');
  const looksUnified = /^(u|zu|tu)(test|regtest)?1/.test(lower);
  if (!looksSapling && !looksUnified) {
    return fail('unknown_format', 'This does not look like a Zcash shielded address. It should start with u1 or zs1.');
  }
  // bech32/bech32m forbid mixed case.
  if (input !== lower && input !== upper) {
    return fail('bad_checksum', 'This address has a typo (mixed upper and lower case). Copy it again from your wallet.');
  }

  try {
    if (looksSapling) {
      decodeSapling(lower);
      return { ok: true, kind: 'sapling', address: lower, hasOrchard: false, hasSapling: true, hasTransparent: false, warnings: [] };
    }
    if (looksUnified) {
      const ua = decodeUnifiedAddress(lower);
      if (ua.expiryTime !== undefined && ua.expiryTime <= nowSeconds) {
        return fail('expired', 'This address has expired. Ask the recipient for a fresh one from their wallet.');
      }
      if (!ua.orchard && !ua.sapling) {
        return fail('no_shielded_receiver', 'This address has no shielded receiver. Use a shielded address from your wallet.');
      }
      const warnings: AddressWarning[] = [];
      const hasTransparent = !!ua.p2pkh || !!ua.p2sh;
      if (hasTransparent) warnings.push('contains_transparent_receiver');
      if (ua.expiryHeight !== undefined) warnings.push('has_expiry_height');
      return {
        ok: true,
        kind: 'unified',
        address: lower,
        hasOrchard: !!ua.orchard,
        hasSapling: !!ua.sapling,
        hasTransparent,
        warnings,
      };
    }
  } catch (e) {
    if (e instanceof Reject) return fail(e.code, e.message);
    throw e;
  }
  return fail('unknown_format', 'This does not look like a Zcash shielded address. It should start with u1 or zs1.');
}
