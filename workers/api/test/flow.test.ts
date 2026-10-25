import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ackCommitment, encodeKey, generateKeyPair, generateToken, hashToken, normalizeReference, openAssignment } from '@mummer/crypto';
import { validateAssignment } from '@mummer/draw';
import { createWorld, drawGroup, openOwnAssignment, setupGroup, NAMES, type World } from './harness.js';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

describe('a complete exchange, end to end', () => {
  it('create -> join x5 -> draw -> assignments -> sent -> acknowledge -> reveal -> delete', async () => {
    const { c, host, members } = await setupGroup(w, 5);

    // The host sees a roster of pseudonyms and aggregate counts only.
    const overview = await c.get(`/api/groups/${host.groupId}`, host.token);
    expect(overview.status).toBe(200);
    expect(overview.body.role).toBe('admin');
    expect(overview.body.roster.map((r: any) => r.pseudonym).sort()).toEqual(NAMES.slice(0, 5).sort());
    expect(overview.body.group.state).toBe('open');

    // Draw (close early: the join window is still open).
    const { res, assignments } = await drawGroup(w, c, host, members);
    expect(res.status).toBe(201);
    expect(res.body.drawVersion).toBe(1);
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.group.state).toBe('drawn');
    expect(validateAssignment(members.map((m) => m.id), assignments).ok).toBe(true);

    // Every member independently opens exactly their own assignment, and it matches the draw.
    const bundles = new Map<string, Awaited<ReturnType<typeof openOwnAssignment>>>();
    for (const m of members) {
      const b = await openOwnAssignment(c, host.groupId, m);
      expect(b.recipient.memberId).toBe(assignments[m.id]);
      const recipient = members.find((x) => x.id === b.recipient.memberId)!;
      expect(b.recipient.pseudonym).toBe(recipient.name);
      expect(b.recipient.address).toBe(recipient.address);
      expect(b.recipient.wishlist).toBe(recipient.wishlist);
      expect(b.budgetCents).toBe(2500);
      bundles.set(m.id, b);
    }

    // The first payment self-report moves the group to 'active' (no more clean redraws).
    const giver = members[0]!;
    const sent = await c.post(`/api/groups/${host.groupId}/members/${giver.id}/sent`, { drawVersion: 1 }, giver.token);
    expect(sent.status).toBe(200);
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.group.state).toBe('active');

    // The recipient of that gift acknowledges it, with the reference from the memo.
    const gift = bundles.get(giver.id)!;
    const recipient = members.find((m) => m.id === gift.recipient.memberId)!;
    const ack = await c.post(`/api/groups/${host.groupId}/members/${recipient.id}/ack`, { drawVersion: 1, outcome: 'received', reference: gift.reference.toLowerCase() }, recipient.token);
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ recipientState: 'recipient_acknowledged', referenceMatched: true });

    // Progress is aggregate-only.
    const prog = (await c.get(`/api/groups/${host.groupId}`, host.token)).body.progress;
    expect(prog).toEqual({ ready: 5, assigned: 5, reportedSent: 1, acknowledged: 1, needsAttention: 0 });

    // Reveals open on the reveal date, not before.
    const early = await c.post(`/api/groups/${host.groupId}/reveals`, { drawVersion: 1, recipientId: recipient.id, reference: gift.reference, audience: 'group' }, giver.token);
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('reveal_not_open');
    w.clock.set('2026-12-24T00:00:01.000Z');
    const reveal = await c.post(`/api/groups/${host.groupId}/reveals`, { drawVersion: 1, recipientId: recipient.id, reference: gift.reference, audience: 'group' }, giver.token);
    expect(reveal.status).toBe(201);
    const confirm = await c.post(`/api/groups/${host.groupId}/reveals/${giver.id}/confirm`, {}, recipient.token);
    expect(confirm.status).toBe(200);
    const seen = await c.get(`/api/groups/${host.groupId}/reveals`, members[3]!.token);
    expect(seen.body.reveals).toEqual([{ giverId: giver.id, recipientId: recipient.id, audience: 'group', confirmedByRecipient: true, declaredDay: '2026-12-24' }]);
    w.clock.set('2026-11-01T12:00:00.000Z');

    // Host deletes everything.
    const del = await c.del(`/api/groups/${host.groupId}`, host.token);
    expect(del.status).toBe(200);
    for (const t of ['groups', 'members', 'assignments', 'ack_commitments', 'reveals', 'audit_events']) {
      const n = await w.db.prepare(`SELECT count(*) AS n FROM ${t} WHERE ${t === 'groups' ? 'id' : 'group_id'} = ?1`).bind(host.groupId).first<{ n: number }>();
      expect(n!.n).toBe(0);
    }
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).status).toBe(401);
    expect((await c.get(`/api/groups/${host.groupId}/invite`)).status).toBe(404);
  }, 60_000);

  it('the stored commitment matches the reference sealed in the giver bundle, filed under the recipient', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    const { res } = await drawGroup(w, c, host, members);
    expect(res.status).toBe(201);
    for (const m of members) {
      const b = await openOwnAssignment(c, host.groupId, m);
      const row = await w.db.prepare('SELECT commitment FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2').bind(host.groupId, b.recipient.memberId).first<{ commitment: string }>();
      expect(row!.commitment).toBe(ackCommitment(host.groupId, b.recipient.memberId, normalizeReference(b.reference)!));
    }
  }, 60_000);
});

describe('credentials and cross-member isolation', () => {
  it("a member cannot read another member's assignment, ack as them, or use the host's powers", async () => {
    const { c, host, members } = await setupGroup(w, 4);
    await drawGroup(w, c, host, members);
    const [a, b] = [members[0]!, members[1]!];
    expect((await c.get(`/api/groups/${host.groupId}/members/${b.id}/assignment`, a.token)).status).toBe(401);
    expect((await c.post(`/api/groups/${host.groupId}/members/${b.id}/ack`, { drawVersion: 1, outcome: 'received' }, a.token)).status).toBe(401);
    expect((await c.post(`/api/groups/${host.groupId}/members/${b.id}/sent`, { drawVersion: 1 }, a.token)).status).toBe(401);
    expect((await c.get(`/api/groups/${host.groupId}/profiles`, a.token)).status).toBe(401);
    expect((await c.post(`/api/groups/${host.groupId}/draw`, {}, a.token, { 'idempotency-key': 'k'.repeat(20) })).status).toBe(401);
    expect((await c.post(`/api/groups/${host.groupId}/transition`, { action: 'close' }, a.token)).status).toBe(401);
    expect((await c.del(`/api/groups/${host.groupId}`, a.token)).status).toBe(401);
    expect((await c.del(`/api/groups/${host.groupId}/members/${b.id}`, a.token)).status).toBe(401);
    expect((await c.get(`/api/groups/${host.groupId}/glassbox`, a.token)).status).toBe(401);
  }, 60_000);

  it("the host's token cannot act as a member, and member tokens cannot cross groups", async () => {
    const one = await setupGroup(w, 4);
    const two = await setupGroup(w, 4);
    await drawGroup(w, one.c, one.host, one.members);
    expect((await one.c.get(`/api/groups/${one.host.groupId}/members/${one.members[0]!.id}/assignment`, one.host.token)).status).toBe(401);
    expect((await one.c.get(`/api/groups/${two.host.groupId}`, one.host.token)).status).toBe(401);
    expect((await one.c.get(`/api/groups/${two.host.groupId}`, one.members[0]!.token)).status).toBe(401);
    expect((await one.c.get(`/api/groups/${two.host.groupId}/members/${two.members[0]!.id}/assignment`, one.members[0]!.token)).status).toBe(401);
    // A member id from another group, with this group's valid token.
    expect((await one.c.get(`/api/groups/${one.host.groupId}/members/${two.members[0]!.id}/assignment`, one.members[0]!.token)).status).toBe(401);
  }, 60_000);

  it('rejects missing, malformed and query-string tokens', async () => {
    const { c, host } = await setupGroup(w, 4);
    expect((await c.get(`/api/groups/${host.groupId}`)).status).toBe(401);
    expect((await c.get(`/api/groups/${host.groupId}`, 'short')).status).toBe(401);
    expect((await c.get(`/api/groups/${host.groupId}`, generateToken())).status).toBe(401);
    expect((await c.get(`/api/groups/${host.groupId}?token=${host.token}`)).status).toBe(401);
    expect((await c.get(`/api/groups/${host.groupId}?t=${host.token}`)).status).toBe(401);
    const odd = await c.call('GET', `/api/groups/${host.groupId}`, { headers: { authorization: `Basic ${host.token}` } });
    expect(odd.status).toBe(401);
    // Unknown group and wrong token are indistinguishable.
    const unknown = await c.get(`/api/groups/${'a'.repeat(32)}`, host.token);
    const wrong = await c.get(`/api/groups/${host.groupId}`, generateToken());
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect((await c.get('/api/groups/not-an-id', host.token)).status).toBe(404);
  }, 60_000);

  it('the same ciphertext is useless to anyone without the member key', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    await drawGroup(w, c, host, members);
    const r = await c.get(`/api/groups/${host.groupId}/members/${members[0]!.id}/assignment`, members[0]!.token);
    const stranger = await generateKeyPair();
    expect(() => openAssignment(r.body.sealedBundle, stranger.publicKey, stranger.secretKey, { groupId: host.groupId, memberId: members[0]!.id, drawVersion: 1 })).toThrow();
    expect(() => openAssignment(r.body.sealedBundle, host.keys.publicKey, host.keys.secretKey, { groupId: host.groupId, memberId: members[0]!.id, drawVersion: 1 })).toThrow();
    for (const other of members.slice(1)) {
      expect(() => openAssignment(r.body.sealedBundle, other.keys.publicKey, other.keys.secretKey, { groupId: host.groupId, memberId: other.id, drawVersion: 1 })).toThrow();
    }
  }, 60_000);
});

describe('misc contract', () => {
  it('encodes keys and hashes consistently between client and server', async () => {
    const kp = await generateKeyPair();
    expect(encodeKey(kp.publicKey)).toHaveLength(43);
    expect(hashToken('x')).toHaveLength(64);
  });
});
