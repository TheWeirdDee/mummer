import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { base64urlnopad } from '@scure/base';
import { SEALED_BYTES, encodeKey, generateToken, hashToken } from '@mummer/crypto';
import { LIMITS } from '@mummer/shared';
import { createGroup, createWorld, drawGroup, joinMember, type Participant, type World } from './harness.js';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

describe('one fixed sealed length, enforced by the server', () => {
  it('the server constant equals the length of what the client produces', () => {
    expect(LIMITS.sealedChars).toBe(base64urlnopad.encode(new Uint8Array(SEALED_BYTES)).length);
  });

  it('a profile sealed to an old 256-byte bucket is refused with a clear message instead of being stored', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const legacyChars = base64urlnopad.encode(new Uint8Array(256 + 48)).length; // what the previous client sent for a short wishlist
    const r = await c.post(`/api/groups/${host.groupId}/members`, {
      pseudonym: 'Legacy',
      publicKey: encodeKey(host.keys.publicKey),
      tokenHash: hashToken(generateToken()),
      addressCommitment: 'c'.repeat(64),
      sealedProfile: 'A'.repeat(legacyChars),
    });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain('out of date');
    const count = await w.db.prepare('SELECT count(*) AS n FROM members WHERE group_id = ?1').bind(host.groupId).first<{ n: number }>();
    expect(count!.n).toBe(0);
  });

  it('a draw containing a bundle of any other length is refused and stores nothing', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const hostKey = encodeKey(host.keys.publicKey);
    const members: Participant[] = [];
    for (let i = 0; i < 4; i++) members.push(await joinMember(c, host, hostKey, `Person${i}`, i));
    const prof = await c.get(`/api/groups/${host.groupId}/profiles`, host.token);
    const body = (shortBundle: boolean) => ({
      drawVersion: 1,
      membersVersion: prof.body.membersVersion,
      closeEarly: true,
      bundles: members.map((m, i) => ({ memberId: m.id, sealedBundle: 'A'.repeat(shortBundle && i === 0 ? 1_200 : LIMITS.sealedChars) })),
      commitments: members.map((m) => ({ memberId: m.id, commitment: 'a'.repeat(64) })),
    });
    const res = await c.post(`/api/groups/${host.groupId}/draw`, body(true), host.token, { 'idempotency-key': generateToken().slice(0, 32) });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('out of date');
    const rows = await w.db.prepare('SELECT count(*) AS n FROM assignments WHERE group_id = ?1').bind(host.groupId).first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  it('the largest allowed group (50 people) can still be drawn: the draw request fits the limit', async () => {
    const c = w.client();
    const host = await createGroup(c, { memberCap: LIMITS.memberCapMax });
    const hostKey = encodeKey(host.keys.publicKey);
    const members: Participant[] = [];
    for (let i = 0; i < LIMITS.memberCapMax; i++) members.push(await joinMember(w.client(), host, hostKey, `Person${String(i).padStart(2, '0')}`, i));
    const { res, payload } = await drawGroup(w, c, host, members);
    // This request is larger than the 256 KiB limit the API used before the fixed sealed size, which made 46 or more people fail with HTTP 413.
    expect(JSON.stringify({ drawVersion: 1, membersVersion: 1, closeEarly: true, ...payload }).length).toBeGreaterThan(256 * 1024);
    expect(res.status).toBe(201);
  }, 180_000);
});
