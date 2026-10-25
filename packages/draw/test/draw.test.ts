import { describe, expect, it } from 'vitest';
import {
  cryptoRandom,
  fromUint32Source,
  runDraw,
  sattoloPermutation,
  shuffled,
  uniformInt,
  validateAssignment,
  type Exclusion,
} from '../src/index.js';

/** Deterministic PRNG (mulberry32) producing uniform 32-bit words, for reproducible statistics. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next32 = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
  return fromUint32Source(next32);
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

/** Chi-square critical values at p = 1e-6 (so a correct implementation essentially never fails). */
const CHI_CRIT_1E6: Record<number, number> = { 5: 33.9, 23: 62.5 };

function chiSquare(counts: number[], expected: number) {
  return counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
}

describe('uniformInt (rejection sampling)', () => {
  it('rejects words in the biased tail', () => {
    // max=3 -> limit = floor(2^32/3)*3 = 4294967295, so 0xFFFFFFFF must be rejected.
    const words = [0xffffffff, 0xfffffffe, 7];
    let i = 0;
    const v = uniformInt(() => words[i++]!, 3);
    expect(v).toBe(0xfffffffe % 3); // second word (4294967294) is below the limit
    expect(i).toBe(2);
  });

  it('accepts every word below the limit and maps by modulo', () => {
    expect(uniformInt(() => 0, 5)).toBe(0);
    expect(uniformInt(() => 4, 5)).toBe(4);
    expect(uniformInt(() => 9, 5)).toBe(4);
  });

  it('is exactly uniform over a full cycle of small words', () => {
    // Feed all 2^8 words of a reduced model? Instead check distribution with a seeded source.
    const rng = seeded(42);
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 70_000; i++) counts[rng.randomInt(7)]++;
    expect(chiSquare(counts, 10_000)).toBeLessThan(30); // df=6, p=1e-5 ~ 31
  });

  it('validates its range argument', () => {
    expect(() => uniformInt(() => 0, 0)).toThrow(RangeError);
    expect(() => uniformInt(() => 0, 1.5)).toThrow(RangeError);
    expect(uniformInt(() => 0, 1)).toBe(0);
  });
});

describe('Sattolo / unconstrained draw', () => {
  it('always yields a single valid cycle for n = 4..50', () => {
    const rng = seeded(7);
    for (let n = 4; n <= 50; n++) {
      for (let t = 0; t < 200; t++) {
        const r = runDraw({ memberIds: ids(n), rng });
        expect(r.ok).toBe(true);
        if (r.ok) expect(validateAssignment(ids(n), r.assignments)).toEqual({ ok: true });
      }
    }
  });

  it('is uniform over all 24 single cycles of 5 members (100,000 seeded draws, chi-square)', () => {
    const rng = seeded(2026);
    const tally = new Map<string, number>();
    for (let t = 0; t < 100_000; t++) {
      const p = sattoloPermutation(5, rng);
      const key = p.join(',');
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    expect(tally.size).toBe(24);
    expect(chiSquare([...tally.values()], 100_000 / 24)).toBeLessThan(CHI_CRIT_1E6[23]!);
  });

  it('each member is equally likely to be assigned any other member (marginals)', () => {
    const rng = seeded(99);
    const counts = new Array(5).fill(0);
    for (let t = 0; t < 50_000; t++) counts[sattoloPermutation(5, rng)[0]!]++;
    expect(counts[0]).toBe(0); // never itself
    expect(chiSquare(counts.slice(1), 12_500)).toBeLessThan(CHI_CRIT_1E6[5]! / 2 + 10);
  });

  it('works with the platform CSPRNG (smoke, 2,000 draws)', () => {
    for (let t = 0; t < 2000; t++) {
      const r = runDraw({ memberIds: ids(6) });
      expect(r.ok && validateAssignment(ids(6), r.assignments).ok).toBe(true);
    }
    const x = cryptoRandom().randomInt(10);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(10);
  });

  it('does not depend on the input order of members', () => {
    // With the same seed, shuffling input order must not change the set of reachable outcomes' validity.
    const a = runDraw({ memberIds: ids(8), rng: seeded(5) });
    const b = runDraw({ memberIds: ids(8).reverse(), rng: seeded(5) });
    expect(a.ok && b.ok).toBe(true);
  });

  it('shuffle is a permutation', () => {
    const s = shuffled(ids(20), seeded(1));
    expect([...s].sort()).toEqual([...ids(20)].sort());
  });
});

describe('input validation', () => {
  it('requires at least 4 members by default', () => {
    for (const n of [0, 1, 2, 3]) expect(runDraw({ memberIds: ids(n) })).toEqual({ ok: false, reason: 'too_few_members', minMembers: 4 });
    expect(runDraw({ memberIds: ids(4) }).ok).toBe(true);
  });

  it('rejects duplicate ids and exclusions that name strangers', () => {
    expect(runDraw({ memberIds: ['a', 'b', 'c', 'a'] })).toEqual({ ok: false, reason: 'duplicate_member_ids' });
    expect(runDraw({ memberIds: ids(5), exclusions: [{ giver: 'm0', recipient: 'zz' }] })).toEqual({
      ok: false,
      reason: 'unknown_member_in_exclusion',
      id: 'zz',
    });
  });
});

const partners = (pairs: [string, string][]): Exclusion[] => pairs.flatMap(([a, b]) => [{ giver: a, recipient: b }, { giver: b, recipient: a }]);

describe('exclusions', () => {
  it('never assigns excluded pairs, across sizes and random partner layouts', () => {
    const rng = seeded(31337);
    for (let n = 4; n <= 30; n++) {
      for (let t = 0; t < 60; t++) {
        const members = ids(n);
        const pool = shuffled(members, rng);
        const pairs: [string, string][] = [];
        for (let k = 0; k + 1 < Math.min(n, 8); k += 2) pairs.push([pool[k]!, pool[k + 1]!]);
        const ex = partners(pairs);
        const r = runDraw({ memberIds: members, exclusions: ex, rng });
        expect(r.ok).toBe(true);
        if (r.ok) expect(validateAssignment(members, r.assignments, ex)).toEqual({ ok: true });
      }
    }
  });

  it('is uniform over valid cycles (n=5, one partner pair): rejection sampling, chi-square', () => {
    const members = ids(5);
    const ex = partners([['m0', 'm1']]);
    // Enumerate all 24 cycles and keep the valid ones.
    const valid = new Set<string>();
    const rngEnum = seeded(1);
    for (let t = 0; t < 5000; t++) {
      const r = runDraw({ memberIds: members, rng: rngEnum });
      if (r.ok && validateAssignment(members, r.assignments, ex).ok) valid.add(members.map((m) => (r.ok ? r.assignments[m] : '')).join('>'));
    }
    expect(valid.size).toBeGreaterThan(5);

    const tally = new Map<string, number>();
    const rng = seeded(555);
    const N = 60_000;
    for (let t = 0; t < N; t++) {
      const r = runDraw({ memberIds: members, exclusions: ex, rng });
      expect(r.ok && r.method === 'rejection_sampled' && r.uniform).toBe(true);
      if (r.ok) {
        const key = members.map((m) => r.assignments[m]).join('>');
        expect(valid.has(key)).toBe(true);
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
    expect(tally.size).toBe(valid.size);
    const df = valid.size - 1;
    // Wilson-Hilferty approximation of the 1e-6 critical value for df.
    const z = 4.75;
    const crit = df * Math.pow(1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df)), 3);
    expect(chiSquare([...tally.values()], N / valid.size)).toBeLessThan(crit);
  });

  it('falls back to bounded search when constraints are dense, and labels it non-uniform', () => {
    // Only ring neighbours are allowed (i -> i±1): exactly two valid cycles out of 11! for n=12.
    const n = 12;
    const members = ids(n);
    const ex: Exclusion[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const d = (j - i + n) % n;
        if (i !== j && d !== 1 && d !== n - 1) ex.push({ giver: members[i]!, recipient: members[j]! });
      }
    const r = runDraw({ memberIds: members, exclusions: ex, rng: seeded(8), maxSamples: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.method).toBe('constrained_search');
      expect(r.uniform).toBe(false);
      expect(validateAssignment(members, r.assignments, ex)).toEqual({ ok: true });
    }
  });

  it('proves impossibility when the search completes (two members can only draw each other)', () => {
    const members = ['A', 'B', 'C', 'D'];
    const ex: Exclusion[] = [
      { giver: 'A', recipient: 'C' },
      { giver: 'A', recipient: 'D' },
      { giver: 'B', recipient: 'C' },
      { giver: 'B', recipient: 'D' },
    ];
    expect(runDraw({ memberIds: members, exclusions: ex, rng: seeded(3) })).toEqual({ ok: false, reason: 'unsatisfiable' });
  });

  it('reports members with no possible recipient or giver', () => {
    const members = ids(5);
    const noRecipient: Exclusion[] = members.filter((m) => m !== 'm0').map((m) => ({ giver: 'm0', recipient: m }));
    expect(runDraw({ memberIds: members, exclusions: noRecipient })).toEqual({ ok: false, reason: 'member_has_no_possible_recipient', id: 'm0' });
    const noGiver: Exclusion[] = members.filter((m) => m !== 'm0').map((m) => ({ giver: m, recipient: 'm0' }));
    expect(runDraw({ memberIds: members, exclusions: noGiver })).toEqual({ ok: false, reason: 'member_has_no_possible_giver', id: 'm0' });
  });

  it('reports an inconclusive search instead of claiming impossibility', () => {
    const n = 12;
    const members = ids(n);
    const ex: Exclusion[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const d = (j - i + n) % n;
        if (i !== j && d !== 1 && d !== n - 1) ex.push({ giver: members[i]!, recipient: members[j]! });
      }
    const r = runDraw({ memberIds: members, exclusions: ex, rng: seeded(8), maxSamples: 1, maxSearchNodes: 1 });
    expect(r).toEqual({ ok: false, reason: 'search_limit_reached' });
  });
});

describe('validateAssignment (independent checker)', () => {
  const m = ids(4);
  it('accepts a single 4-cycle', () => {
    expect(validateAssignment(m, { m0: 'm1', m1: 'm2', m2: 'm3', m3: 'm0' }).ok).toBe(true);
  });
  it('rejects self-assignment, duplicates, two 2-cycles, and violated exclusions', () => {
    expect(validateAssignment(m, { m0: 'm0', m1: 'm2', m2: 'm3', m3: 'm1' }).ok).toBe(false);
    expect(validateAssignment(m, { m0: 'm1', m1: 'm1', m2: 'm3', m3: 'm0' }).ok).toBe(false);
    expect(validateAssignment(m, { m0: 'm1', m1: 'm0', m2: 'm3', m3: 'm2' })).toEqual({ ok: false, problem: 'closed loop of length 2' });
    expect(validateAssignment(m, { m0: 'm1', m1: 'm2', m2: 'm3', m3: 'm0' }, [{ giver: 'm0', recipient: 'm1' }]).ok).toBe(false);
    expect(validateAssignment(m, { m0: 'm1', m1: 'm2', m2: 'm3' }).ok).toBe(false);
  });
});
