import { describe, expect, it } from 'vitest';
import {
  addDays,
  ackBody,
  bundlePlain,
  canTransitionGroup,
  canTransitionRecipient,
  createGroupBody,
  dayBucket,
  daysBetween,
  drawBody,
  hasDraw,
  isValidDate,
  isValidTimezone,
  joinBody,
  joinClosesAt,
  localMidnightUtc,
  profilePlain,
  revealEligible,
  revealOpensAt,
  todayIn,
  GROUP_STATES,
  nextGroupStates,
} from '../src/index.js';

describe('timezone-aware instants', () => {
  it('computes local midnight in UTC', () => {
    expect(localMidnightUtc('2026-12-25', 'UTC').toISOString()).toBe('2026-12-25T00:00:00.000Z');
  });

  it('handles standard and daylight offsets (America/New_York)', () => {
    expect(localMidnightUtc('2026-12-25', 'America/New_York').toISOString()).toBe('2026-12-25T05:00:00.000Z');
    expect(localMidnightUtc('2026-07-04', 'America/New_York').toISOString()).toBe('2026-07-04T04:00:00.000Z');
  });

  it('handles the DST transition days correctly', () => {
    // US spring forward 2026-03-08 (02:00 -> 03:00): midnight is still EST (UTC-5).
    expect(localMidnightUtc('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    // The next day is EDT (UTC-4).
    expect(localMidnightUtc('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    // US fall back 2026-11-01: midnight is still EDT, next midnight is EST.
    expect(localMidnightUtc('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(localMidnightUtc('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('handles half-hour and far-east zones', () => {
    expect(localMidnightUtc('2026-12-25', 'Asia/Kolkata').toISOString()).toBe('2026-12-24T18:30:00.000Z');
    expect(localMidnightUtc('2026-12-25', 'Pacific/Auckland').toISOString()).toBe('2026-12-24T11:00:00.000Z');
    expect(localMidnightUtc('2026-12-25', 'Australia/Lord_Howe').toISOString()).toBe('2026-12-24T13:00:00.000Z');
  });

  it('local midnight round-trips to the same local date', () => {
    for (const tz of ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Sao_Paulo', 'Asia/Kathmandu']) {
      for (const d of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29']) {
        const t = localMidnightUtc(d, tz);
        expect(todayIn(tz, t)).toBe(d);
        expect(todayIn(tz, new Date(t.getTime() - 1))).toBe(addDays(d, -1));
      }
    }
  });

  it('join closes at the start of the day after the deadline', () => {
    expect(joinClosesAt('2026-12-01', 'UTC').toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(revealOpensAt('2026-12-24', 'Europe/London').toISOString()).toBe('2026-12-24T00:00:00.000Z');
  });

  it('validates dates and timezones', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('26-1-1')).toBe(false);
    expect(isValidTimezone('Europe/Paris')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(() => localMidnightUtc('2026-02-30', 'UTC')).toThrow(RangeError);
  });

  it('date arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-12-01', '2026-12-25')).toBe(24);
    expect(dayBucket(new Date('2026-10-26T23:59:59Z'))).toBe('2026-10-26');
  });
});

describe('group state machine', () => {
  it('allows the intended forward path', () => {
    const path = ['open', 'locked', 'drawn', 'active', 'closed'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransitionGroup(path[i]!, path[i + 1]!)).toBe(true);
  });

  it('allows only the documented loops and exceptions', () => {
    expect(canTransitionGroup('drawn', 'locked')).toBe(true); // redraw reset, before any payment activity
    expect(canTransitionGroup('active', 'locked')).toBe(false); // no silent redraw after sends
    expect(canTransitionGroup('active', 'drawn')).toBe(false);
    expect(canTransitionGroup('active', 'needs_resolution')).toBe(true);
    expect(canTransitionGroup('needs_resolution', 'active')).toBe(true);
    expect(canTransitionGroup('closed', 'open')).toBe(false);
    expect(nextGroupStates('closed')).toEqual([]);
  });

  it('never allows a state to transition to itself', () => {
    for (const s of GROUP_STATES) expect(canTransitionGroup(s, s)).toBe(false);
  });

  it('recipient states cannot go backwards and "verified" does not exist', () => {
    expect(canTransitionRecipient('not_acknowledged', 'recipient_acknowledged')).toBe(true);
    expect(canTransitionRecipient('disputed', 'recipient_acknowledged')).toBe(true);
    expect(canTransitionRecipient('recipient_acknowledged', 'disputed')).toBe(false);
    expect(canTransitionRecipient('recipient_acknowledged', 'not_acknowledged')).toBe(false);
  });

  it('reveal eligibility is derived from the clock and requires a draw', () => {
    const at = '2026-12-24T00:00:00.000Z';
    expect(revealEligible('active', at, new Date('2026-12-23T23:59:59Z'))).toBe(false);
    expect(revealEligible('active', at, new Date('2026-12-24T00:00:00Z'))).toBe(true);
    expect(revealEligible('open', at, new Date('2027-01-01T00:00:00Z'))).toBe(false);
    expect(hasDraw('locked')).toBe(false);
    expect(hasDraw('drawn')).toBe(true);
  });
});

const key = 'A'.repeat(43);
const hash = 'a'.repeat(64);
const id = 'b'.repeat(32);

describe('request schemas', () => {
  const group = {
    title: '  Office Santa 2026 ',
    budgetCents: 2500,
    joinDeadline: '2026-12-01',
    revealDate: '2026-12-24',
    timezone: 'Europe/Paris',
    memberCap: 20,
    hostPlays: false,
    hostPublicKey: key,
    adminTokenHash: hash,
  };

  it('accepts a valid group and normalizes the title', () => {
    const r = createGroupBody.parse(group);
    expect(r.title).toBe('Office Santa 2026');
  });

  it.each([
    ['title too short', { title: 'ab' }],
    ['title with control char', { title: 'Hi' + String.fromCharCode(7) + ' there' }],
    ['budget below minimum', { budgetCents: 499 }],
    ['budget above cap', { budgetCents: 25_001 }],
    ['fractional budget', { budgetCents: 1000.5 }],
    ['member cap below 4', { memberCap: 3 }],
    ['member cap above 50', { memberCap: 51 }],
    ['reveal on the join deadline day', { revealDate: '2026-12-01' }],
    ['reveal before the deadline', { revealDate: '2026-11-30' }],
    ['invalid timezone', { timezone: 'Nowhere/Land' }],
    ['invalid date', { joinDeadline: '2026-02-30' }],
    ['bad public key length', { hostPublicKey: 'A'.repeat(42) }],
    ['uppercase token hash', { adminTokenHash: 'A'.repeat(64) }],
    ['unknown field', { admin: true }],
  ])('rejects: %s', (_n, patch) => {
    expect(createGroupBody.safeParse({ ...group, ...patch }).success).toBe(false);
  });

  it('join: counts display-name length in code points, not UTF-16 units', () => {
    const base = { publicKey: key, tokenHash: hash, sealedProfile: 'x'.repeat(100) };
    expect(joinBody.safeParse({ ...base, pseudonym: '🎅🎅' }).success).toBe(true);
    expect(joinBody.safeParse({ ...base, pseudonym: '🎅' }).success).toBe(false);
    expect(joinBody.safeParse({ ...base, pseudonym: 'a'.repeat(33) }).success).toBe(false);
    expect(joinBody.safeParse({ ...base, pseudonym: 'Ada', sealedProfile: 'x'.repeat(9000) }).success).toBe(false);
    expect(joinBody.safeParse({ ...base, pseudonym: 'Ada', sealedProfile: 'has spaces and !!!' }).success).toBe(false);
  });

  it('draw: requires at least 4 bundles and commitments, rejects extra fields', () => {
    const b = (n: number) => Array.from({ length: n }, (_, i) => ({ memberId: String(i).repeat(32).slice(0, 32).replace(/[^0-9a-f]/g, 'a'), sealedBundle: 'y'.repeat(60) }));
    const c = (n: number) => Array.from({ length: n }, (_, i) => ({ memberId: String(i).repeat(32).slice(0, 32).replace(/[^0-9a-f]/g, 'a'), commitment: hash }));
    expect(drawBody.safeParse({ drawVersion: 1, bundles: b(4), commitments: c(4) }).success).toBe(true);
    expect(drawBody.safeParse({ drawVersion: 1, bundles: b(3), commitments: c(4) }).success).toBe(false);
    expect(drawBody.safeParse({ drawVersion: 0, bundles: b(4), commitments: c(4) }).success).toBe(false);
    expect(drawBody.safeParse({ drawVersion: 1, bundles: b(4), commitments: c(4), pairs: [] }).success).toBe(false);
  });

  it('ack: a reference only accompanies a receipt', () => {
    expect(ackBody.safeParse({ drawVersion: 1, outcome: 'received', reference: 'MUM-7Q4K-X2J9-PA3M-WV8T-C' }).success).toBe(true);
    expect(ackBody.safeParse({ drawVersion: 1, outcome: 'received' }).success).toBe(true);
    expect(ackBody.safeParse({ drawVersion: 1, outcome: 'problem', reference: 'MUM-7Q4K-X2J9-PA3M-WV8T-C' }).success).toBe(false);
    expect(ackBody.safeParse({ drawVersion: 1, outcome: 'verified' }).success).toBe(false);
  });
});

describe('sealed payload schemas', () => {
  it('profile: wishlist keeps newlines but rejects other control characters', () => {
    const base = { v: 1, kind: 'profile', groupId: id, pseudonym: 'Ada', address: 'u1' + 'q'.repeat(40) };
    expect(profilePlain.safeParse({ ...base, wishlist: 'socks\nbooks' }).success).toBe(true);
    expect(profilePlain.safeParse({ ...base, wishlist: 'a' + String.fromCharCode(0) + 'b' }).success).toBe(false);
    expect(profilePlain.safeParse({ ...base, wishlist: 'x'.repeat(281) }).success).toBe(false);
    expect(profilePlain.safeParse({ ...base, wishlist: '', kind: 'assignment' }).success).toBe(false);
  });

  it('bundle: bounded and strict', () => {
    const ok = {
      v: 1,
      kind: 'assignment',
      groupId: id,
      drawVersion: 1,
      giverId: id,
      recipient: { memberId: id, pseudonym: 'Grace', wishlist: '', address: 'u1' + 'q'.repeat(40) },
      reference: 'MUM-7Q4K-X2J9-PA3M-WV8T-C',
      budgetCents: 2500,
    };
    expect(bundlePlain.safeParse(ok).success).toBe(true);
    expect(bundlePlain.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(bundlePlain.safeParse({ ...ok, budgetCents: 1 }).success).toBe(false);
  });
});
