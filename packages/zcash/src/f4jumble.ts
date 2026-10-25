import { blake2b } from '@noble/hashes/blake2.js';

/**
 * F4Jumble and its inverse, as specified in ZIP 316 ("Jumbling").
 * Verified against the official zcash-test-vectors (test/vectors/f4jumble*.json).
 *
 * This is a public, keyless, unauthenticated permutation used so that every
 * character of a Unified Address depends on every other; it is NOT encryption.
 */

export const F4_MIN_LEN = 38;
export const F4_MAX_LEN = 4_194_368;

const enc = new TextEncoder();
const PERS_H = enc.encode('UA_F4Jumble_H');
const PERS_G = enc.encode('UA_F4Jumble_G');

function personalH(i: number): Uint8Array {
  const p = new Uint8Array(16);
  p.set(PERS_H, 0);
  p[13] = i;
  return p;
}

function personalG(i: number, j: number): Uint8Array {
  const p = new Uint8Array(16);
  p.set(PERS_G, 0);
  p[13] = i;
  p[14] = j & 0xff;
  p[15] = (j >> 8) & 0xff;
  return p;
}

function hRound(i: number, u: Uint8Array, outLen: number): Uint8Array {
  return blake2b(u, { dkLen: outLen, personalization: personalH(i) });
}

function gRound(i: number, u: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  const blocks = Math.ceil(outLen / 64);
  for (let j = 0; j < blocks; j++) {
    const block = blake2b(u, { dkLen: 64, personalization: personalG(i, j) });
    out.set(block.subarray(0, Math.min(64, outLen - j * 64)), j * 64);
  }
  return out;
}

function xorInto(dst: Uint8Array, src: Uint8Array): Uint8Array {
  const out = new Uint8Array(dst.length);
  for (let k = 0; k < dst.length; k++) out[k] = dst[k]! ^ src[k]!;
  return out;
}

function split(m: Uint8Array): { lenL: number; a: Uint8Array; b: Uint8Array } {
  if (m.length < F4_MIN_LEN || m.length > F4_MAX_LEN) {
    throw new RangeError(`F4Jumble input must be ${F4_MIN_LEN}..${F4_MAX_LEN} bytes`);
  }
  const lenL = Math.min(64, Math.floor(m.length / 2));
  return { lenL, a: m.subarray(0, lenL), b: m.subarray(lenL) };
}

export function f4jumble(m: Uint8Array): Uint8Array {
  const { lenL, a, b } = split(m);
  const lenR = b.length;
  const x = xorInto(b, gRound(0, a, lenR));
  const y = xorInto(a, hRound(0, x, lenL));
  const d = xorInto(x, gRound(1, y, lenR));
  const c = xorInto(y, hRound(1, d, lenL));
  const out = new Uint8Array(m.length);
  out.set(c, 0);
  out.set(d, lenL);
  return out;
}

export function f4jumbleInv(m: Uint8Array): Uint8Array {
  const { lenL, a: c, b: d } = split(m);
  const lenR = d.length;
  const y = xorInto(c, hRound(1, d, lenL));
  const x = xorInto(d, gRound(1, y, lenR));
  const a = xorInto(y, hRound(0, x, lenL));
  const b = xorInto(x, gRound(0, a, lenR));
  const out = new Uint8Array(m.length);
  out.set(a, 0);
  out.set(b, lenL);
  return out;
}
