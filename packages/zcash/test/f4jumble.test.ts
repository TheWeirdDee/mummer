import { describe, expect, it } from 'vitest';
import { base16 } from '@scure/base';
import { blake2b } from '@noble/hashes/blake2.js';
import { f4jumble, f4jumbleInv } from '../src/f4jumble.js';
import vectors from './vectors/f4jumble.json' with { type: 'json' };
import long from './vectors/f4jumble_long.json' with { type: 'json' };

const hex = (s: string) => base16.decode(s.toUpperCase());

describe('F4Jumble (ZIP 316) official vectors', () => {
  const rows = (vectors as unknown[][]).filter((r) => typeof r[0] === 'string' && (r[0] as string).length > 0 && /^[0-9a-f]+$/.test(r[0] as string));

  it('has vectors to run', () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it('jumbles every vector exactly', () => {
    for (const [normal, jumbled] of rows as [string, string][]) {
      expect(base16.encode(f4jumble(hex(normal))).toLowerCase()).toBe(jumbled);
    }
  });

  it('inverts every vector exactly', () => {
    for (const [normal, jumbled] of rows as [string, string][]) {
      expect(base16.encode(f4jumbleInv(hex(jumbled))).toLowerCase()).toBe(normal);
    }
  });

  it('rejects inputs shorter than 38 bytes', () => {
    expect(() => f4jumble(new Uint8Array(37))).toThrow(RangeError);
    expect(() => f4jumbleInv(new Uint8Array(37))).toThrow(RangeError);
  });
});

describe('F4Jumble long vectors', () => {
  // Generator (zcash-test-vectors f4jumble.py): M[i] = i & 0xFF; expected = BLAKE2b-512(f4jumble(M)).
  const rows = (long as unknown[][]).filter((r) => typeof r[0] === 'number') as [number, string][];

  it.each(rows)('matches the published digest for length %i', (len, digest) => {
    const m = new Uint8Array(len);
    for (let i = 0; i < len; i++) m[i] = i & 0xff;
    const jumbled = f4jumble(m);
    expect(base16.encode(blake2b(jumbled, { dkLen: 64 })).toLowerCase()).toBe(digest);
    expect(f4jumbleInv(jumbled)).toEqual(m);
  }, 180_000); // the two multi-megabyte vectors take about 30 s each in pure JS; real addresses are ~100 bytes so this is a test-only cost
});
