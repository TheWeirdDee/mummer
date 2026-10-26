import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addressCommitment, encodeKey, generateKeyPair, generateToken, hashToken, sealProfile } from '@mummer/crypto';
import { createWorld, createGroup, drawGroup, openOwnAssignment, setupGroup, testAddress, type World } from './harness.js';
import { isUsableX25519PublicKey } from '../src/keys.js';
import { normalizeClient } from '../src/ratelimit.js';
import { humanCheckRequired } from '../src/services.js';
import type { Env } from '../src/env.js';

/** Regression tests for the findings of the independent security audit (see docs/FINAL_AUDIT.md). */

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString('base64url');
const ZERO = b64(new Array(32).fill(0));
const ORDER4 = b64([1, ...new Array(31).fill(0)]);
const ORDER8 = Buffer.from('e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800', 'hex').toString('base64url');
const NONCANON = b64([0xec, ...new Array(30).fill(0xff), 0x7f]);

describe('member public keys must be usable (one member cannot block a draw)', () => {
  it('accepts real keys and rejects zero, low-order, non-canonical and malformed ones', async () => {
    const kp = await generateKeyPair();
    expect(isUsableX25519PublicKey(encodeKey(kp.publicKey))).toBe(true);
    for (const bad of [ZERO, ORDER4, ORDER8, NONCANON, 'short', 'A'.repeat(44), '!'.repeat(43)]) expect(isUsableX25519PublicKey(bad)).toBe(false);
  });

  it('is enforced at joining and at rotation', async () => {
    const { c, host, members, hostKeyB64 } = await setupGroup(w, 4);
    for (const bad of [ZERO, ORDER4, ORDER8]) {
      const r = await c.post(`/api/groups/${host.groupId}/members`, {
        pseudonym: 'Mallory',
        publicKey: bad,
        tokenHash: hashToken(generateToken()),
        sealedProfile: sealProfile({ v: 1, kind: 'profile', groupId: host.groupId, pseudonym: 'Mallory', wishlist: '', address: testAddress(9) }, hostKeyB64),
        addressCommitment: addressCommitment(host.groupId, 'Mallory', testAddress(9)),
      });
      expect(r.status).toBe(422);
    }
    const rot = await c.post(`/api/groups/${host.groupId}/members/${members[0]!.id}/rotate`, { newTokenHash: hashToken(generateToken()), newPublicKey: ZERO }, members[0]!.token);
    expect(rot.status).toBe(422);
    expect((await c.get(`/api/groups/${host.groupId}/members/${members[0]!.id}/assignment`, members[0]!.token)).status).toBe(404); // still authenticates: rotation did not happen
  });
});

describe('the draw is bound to the exact member list and keys the host read', () => {
  it('a member rotating their key while the host is reviewing makes the draw refuse, instead of sealing to a replaced key', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    const kp = await generateKeyPair();
    const d = await drawGroup(w, c, host, members, {
      beforePost: async () => {
        const r = await c.post(`/api/groups/${host.groupId}/members/${members[1]!.id}/rotate`, { newTokenHash: hashToken(generateToken()), newPublicKey: encodeKey(kp.publicKey) }, members[1]!.token);
        expect(r.status).toBe(200);
      },
    });
    expect(d.res.status).toBe(409);
    expect(d.res.body.error.code).toBe('draw_mismatch');
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.group.state).toBe('open');
  });

  it('someone leaving, being removed or joining mid-draw also makes it refuse; a clean retry then succeeds', async () => {
    const { c, host, members } = await setupGroup(w, 6);
    const left = await drawGroup(w, c, host, members, { beforePost: async () => void (await c.post(`/api/groups/${host.groupId}/members/${members[5]!.id}/leave`, {}, members[5]!.token)) });
    expect(left.res.status).toBe(409);
    const removed = await drawGroup(w, c, host, members, { beforePost: async () => void (await c.del(`/api/groups/${host.groupId}/members/${members[4]!.id}`, host.token)) });
    expect(removed.res.status).toBe(409);
    const ok = await drawGroup(w, c, host, members);
    expect(ok.res.status).toBe(201);
  });
});

describe('address commitments: a host cannot silently redirect a gift', () => {
  it('the server exposes each member’s commitment, and the giver can check the sealed address against it', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    await drawGroup(w, c, host, members);
    const view = await c.get(`/api/groups/${host.groupId}`, members[0]!.token);
    const roster = new Map<string, { addressCommitment: string; pseudonym: string }>(view.body.roster.map((r: any) => [r.id, r]));
    for (const m of members) {
      const b = await openOwnAssignment(c, host.groupId, m);
      const entry = roster.get(b.recipient.memberId)!;
      expect(entry.addressCommitment).toBe(addressCommitment(host.groupId, entry.pseudonym, b.recipient.address));
    }
  });

  it('a substituted address would NOT match the commitment the host cannot change', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    const view = await c.get(`/api/groups/${host.groupId}`, host.token);
    const target = view.body.roster[0];
    expect(addressCommitment(host.groupId, target.pseudonym, 'u1attackeraddress'.padEnd(60, 'q'))).not.toBe(target.addressCommitment);
    // And there is no host endpoint that changes a member's stored commitment.
    for (const path of [`/api/groups/${host.groupId}/members/${members[0]!.id}`]) {
      expect((await c.call('PUT', path, { token: host.token, body: { addressCommitment: 'f'.repeat(64) } })).status).toBe(404);
      expect((await c.call('PATCH', path, { token: host.token, body: { addressCommitment: 'f'.repeat(64) } })).status).toBe(404);
    }
  });

  it('joining requires a well-formed commitment', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const kp = await generateKeyPair();
    const base = { pseudonym: 'Ada', publicKey: encodeKey(kp.publicKey), tokenHash: hashToken(generateToken()), sealedProfile: 'A'.repeat(100) };
    expect((await c.post(`/api/groups/${host.groupId}/members`, base)).status).toBe(422);
    expect((await c.post(`/api/groups/${host.groupId}/members`, { ...base, addressCommitment: 'nothex' })).status).toBe(422);
  });

  it('the commitment is bound to the group and the nickname', () => {
    const a = addressCommitment('a'.repeat(32), 'Ada', 'u1xyz');
    expect(addressCommitment('b'.repeat(32), 'Ada', 'u1xyz')).not.toBe(a);
    expect(addressCommitment('a'.repeat(32), 'Grace', 'u1xyz')).not.toBe(a);
    expect(addressCommitment('a'.repeat(32), 'Ada', 'u1xyw')).not.toBe(a);
  });
});

describe('the host-facing database view carries no per-person sent or confirmed state', () => {
  it('shows totals only, even after sends, acknowledgments and a reported problem', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    await drawGroup(w, c, host, members);
    await c.post(`/api/groups/${host.groupId}/members/${members[0]!.id}/sent`, { drawVersion: 1 }, members[0]!.token);
    await c.post(`/api/groups/${host.groupId}/members/${members[1]!.id}/ack`, { drawVersion: 1, outcome: 'received' }, members[1]!.token);
    await c.post(`/api/groups/${host.groupId}/members/${members[2]!.id}/ack`, { drawVersion: 1, outcome: 'problem' }, members[2]!.token);
    const g = await c.get(`/api/groups/${host.groupId}/glassbox`, host.token);
    const text = JSON.stringify(g.body);
    for (const forbidden of ['sender_state', 'user_reports_sent', 'recipient_acknowledged', 'disputed', 'reference_matched', 'state_day', 'not_acknowledged']) expect(text, forbidden).not.toContain(forbidden);
    expect(g.body.totals).toEqual({ reportedSent: 1, acknowledged: 1, reportedProblem: 1 });
    for (const m of g.body.members) expect(Object.keys(m).sort()).toEqual(['address_commitment', 'id', 'joined_day', 'pseudonym', 'public_key', 'sealed_profile', 'status', 'token_hash']);
    for (const k of g.body.ack_commitments) expect(Object.keys(k).sort()).toEqual(['commitment', 'draw_version', 'recipient_member_id']);
  });
});

describe('abuse resistance details', () => {
  it('IPv6 clients are limited by /64, not by individual address', async () => {
    expect(normalizeClient('2001:db8:aaaa:bbbb:1:2:3:4')).toBe('v6:2001:0db8:aaaa:bbbb');
    expect(normalizeClient('2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff')).toBe(normalizeClient('2001:db8:aaaa:bbbb::1'));
    expect(normalizeClient('2001:DB8::1')).toBe('v6:2001:0db8:0000:0000');
    expect(normalizeClient('::1')).toBe('v6:0000:0000:0000:0000');
    expect(normalizeClient('2001:db8:aaaa:cccc::1')).not.toBe(normalizeClient('2001:db8:aaaa:bbbb::1'));
    expect(normalizeClient('203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeClient('unknown')).toBe('unknown');
    expect(normalizeClient('not:an:address')).toBe('not:an:address');
    // End to end: rotating through addresses inside one /64 does not escape the creation limit (10 per hour).
    const prefix = '2001:db8:1:2';
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const kp = await generateKeyPair();
      const r = await w.client(`${prefix}:${i}::${i + 1}`).post('/api/groups', {
        title: 'IPv6 test',
        budgetCents: 2500,
        joinDeadline: '2026-11-20',
        revealDate: '2026-12-24',
        timezone: 'UTC',
        memberCap: 20,
        hostPlays: false,
        hostPublicKey: encodeKey(kp.publicKey),
        adminTokenHash: hashToken(generateToken()),
      });
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it('production refuses to serve rate-limited routes without a real salt (never the public default)', async () => {
    const prod = await createWorld({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 's', RATE_LIMIT_SALT: undefined });
    try {
      const r = await prod.client().post('/api/human/verify', { token: 'turnstile-ok' });
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/SALT/);
    } finally {
      await prod.dispose();
    }
  }, 60_000);

  it('only the explicit development and test environments relax the human check', () => {
    const e = (ENVIRONMENT: string, secret?: string) => ({ ENVIRONMENT, TURNSTILE_SECRET: secret }) as unknown as Env;
    expect(humanCheckRequired(e('production'))).toBe(true);
    expect(humanCheckRequired(e('staging'))).toBe(true);
    expect(humanCheckRequired(e(''))).toBe(true);
    expect(humanCheckRequired(e('Production'))).toBe(true);
    expect(humanCheckRequired(e('development'))).toBe(false);
    expect(humanCheckRequired(e('test'))).toBe(false);
    expect(humanCheckRequired(e('development', 'secret'))).toBe(true);
  });
});

describe('races and bookkeeping', () => {
  it('two simultaneous copies of the same draw request: one creates it and the other is told it is already done (replay), never a spurious conflict', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    let payloadBody: Record<string, unknown> | undefined;
    const first = await drawGroup(w, c, host, members, { key: 'r'.repeat(24), beforePost: async () => undefined });
    expect(first.res.status).toBe(201);
    payloadBody = { drawVersion: 1, membersVersion: 0, closeEarly: true, ...first.payload };
    const mv = (await w.db.prepare('SELECT members_version AS v FROM groups WHERE id = ?1').bind(host.groupId).first<{ v: number }>())!.v;
    payloadBody.membersVersion = mv;
    const [a, b] = await Promise.all([
      c.post(`/api/groups/${host.groupId}/draw`, payloadBody, host.token, { 'idempotency-key': 'r'.repeat(24) }),
      c.post(`/api/groups/${host.groupId}/draw`, payloadBody, host.token, { 'idempotency-key': 'r'.repeat(24) }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('a simultaneous pair of fresh draws with the SAME key yields one 201 and one 200 replay', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    const first = await drawGroup(w, c, host, members, { key: 'q'.repeat(24), beforePost: async () => undefined }).catch(() => undefined);
    expect(first).toBeDefined();
    // Reset to an open state and race two identical requests.
    await c.post(`/api/groups/${host.groupId}/transition`, { action: 'reset_draw' }, host.token);
    const prof = await c.get(`/api/groups/${host.groupId}/profiles`, host.token);
    const body = { drawVersion: 2, membersVersion: prof.body.membersVersion, closeEarly: true, ...first!.payload };
    const [a, b] = await Promise.all([
      c.post(`/api/groups/${host.groupId}/draw`, body, host.token, { 'idempotency-key': 's'.repeat(24) }),
      c.post(`/api/groups/${host.groupId}/draw`, body, host.token, { 'idempotency-key': 's'.repeat(24) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const n = await w.db.prepare('SELECT count(*) AS n FROM assignments WHERE group_id = ?1').bind(host.groupId).first<{ n: number }>();
    expect(n!.n).toBe(5);
  });

  it('a transition that loses its compare-and-swap leaves no audit event', async () => {
    const { c, host } = await setupGroup(w, 4);
    const t = () => c.post(`/api/groups/${host.groupId}/transition`, { action: 'lock' }, host.token);
    const [a, b] = await Promise.all([t(), t()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const n = await w.db.prepare("SELECT count(*) AS n FROM audit_events WHERE group_id = ?1 AND type = 'group_locked'").bind(host.groupId).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('a draw body between 96 and 256 KiB is not rejected for size; one over 256 KiB is', async () => {
    const { c, host } = await setupGroup(w, 4);
    const big = (n: number) => ({ drawVersion: 1, membersVersion: 0, closeEarly: true, bundles: [], commitments: [], pad: 'x'.repeat(n) });
    const small = await c.post(`/api/groups/${host.groupId}/draw`, big(150_000), host.token, { 'idempotency-key': 'z'.repeat(24) });
    expect(small.status).toBe(422); // reaches validation (strict schema), so the size cap did not stop it
    const huge = await c.post(`/api/groups/${host.groupId}/draw`, big(300_000), host.token, { 'idempotency-key': 'z'.repeat(24) });
    expect(huge.status).toBe(413);
  });

  it('a non-constraint database fault is a generic 500, not disguised as a conflict', async () => {
    const broken = await createWorld();
    try {
      const { c, host, hostKeyB64 } = await setupGroup(broken, 4);
      await broken.db.prepare('DROP TABLE stats').run(); // joining updates the counters table inside its batch
      const kp = await generateKeyPair();
      const r = await c.post(`/api/groups/${host.groupId}/members`, {
        pseudonym: 'Fault',
        publicKey: encodeKey(kp.publicKey),
        tokenHash: hashToken(generateToken()),
        sealedProfile: sealProfile({ v: 1, kind: 'profile', groupId: host.groupId, pseudonym: 'Fault', wishlist: '', address: testAddress(2) }, hostKeyB64),
        addressCommitment: addressCommitment(host.groupId, 'Fault', testAddress(2)),
      });
      expect(r.status).toBe(500);
      expect(r.body.error.code).toBe('internal');
    } finally {
      await broken.dispose();
    }
  }, 60_000);
});
