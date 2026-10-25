/**
 * Randomness for the draw. Production uses crypto.getRandomValues with
 * rejection sampling (no modulo bias). The source is injectable so tests can
 * use a seeded generator and verify the sampling logic deterministically.
 */

export interface RandomSource {
  /** Returns an unbiased integer in [0, maxExclusive). maxExclusive must be 1..2^32. */
  randomInt(maxExclusive: number): number;
}

export type Uint32Source = () => number;

const TWO_32 = 0x1_0000_0000;

/** Unbiased integer in [0, max) from a source of uniform 32-bit words, by rejection sampling. */
export function uniformInt(next32: Uint32Source, max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > TWO_32) throw new RangeError('max must be an integer in 1..2^32');
  if (max === 1) return 0;
  // Largest multiple of max that fits in 2^32; words at or above it would bias the low residues.
  const limit = Math.floor(TWO_32 / max) * max;
  for (;;) {
    const x = next32();
    if (x < limit) return x % max;
  }
}

export function fromUint32Source(next32: Uint32Source): RandomSource {
  return { randomInt: (max) => uniformInt(next32, max) };
}

/** The production random source: the platform CSPRNG. */
export function cryptoRandom(): RandomSource {
  const buf = new Uint32Array(64);
  let i = buf.length;
  const next32: Uint32Source = () => {
    if (i >= buf.length) {
      (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(buf);
      i = 0;
    }
    return buf[i++]!;
  };
  return fromUint32Source(next32);
}

/** Fisher-Yates shuffle (unbiased) using the given source. Returns a new array. */
export function shuffled<T>(items: readonly T[], rng: RandomSource): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
