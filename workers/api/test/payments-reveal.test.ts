import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeKey, generateKeyPair, generateReference, generateToken, hashToken, openAssignment, resealAssignment } from '@mummer/crypto';
import { createWorld, drawGroup, openOwnAssignment, setupGroup, type Participant, type World } from './harness.js';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

/** A drawn group where every member has opened their bundle. */
async function drawn(n = 5) {
  const s = await setupGroup(w, n);
  const d = await drawGroup(w, s.c, s.host, s.members);
  expect(d.res.status).toBe(201);
  const bundles = new Map<string, Awaited<ReturnType<typeof openOwnAssignment>>>();
  for (const m of s.members) bundles.set(m.id, await openOwnAssignment(s.c, s.host.groupId, m));
  const recipientOf = (giver: Participant) => s.members.find((x) => x.id === bundles.get(giver.id)!.recipient.memberId)!;
  const giverOf = (recipient: Participant) => s.members.find((m) => bundles.get(m.id)!.recipient.memberId === recipient.id)!;
  return { ...s, bundles, recipientOf, giverOf };
}

const ackUrl = (g: string, m: Participant) => `/api/groups/${g}/members/${m.id}/ack`;
const progress = async (s: Awaited<ReturnType<typeof drawn>>) => (await s.c.get(`/api/groups/${s.host.groupId}`, s.host.token)).body.progress;

describe('sender self-report', () => {
  it('is idempotent, counted once, and moves the group to active', async () => {
    const s = await drawn();
    const m = s.members[0]!;
    const url = `/api/groups/${s.host.groupId}/members/${m.id}/sent`;
    expect((await s.c.post(url, { drawVersion: 1 }, m.token)).body).toEqual({ senderState: 'user_reports_sent' });
    expect((await s.c.post(url, { drawVersion: 1 }, m.token)).status).toBe(200);
    expect((await progress(s)).reportedSent).toBe(1);
    expect((await s.c.get(`/api/groups/${s.host.groupId}`, s.host.token)).body.group.state).toBe('active');
  });

  it('rejects the wrong draw version, an unknown body, and use before the draw', async () => {
    const s = await drawn();
    const m = s.members[0]!;
    const url = `/api/groups/${s.host.groupId}/members/${m.id}/sent`;
    expect((await s.c.post(url, { drawVersion: 2 }, m.token)).status).toBe(409);
    expect((await s.c.post(url, { drawVersion: 1, extra: 1 }, m.token)).status).toBe(422);
    const fresh = await setupGroup(w, 4);
    const r = await fresh.c.post(`/api/groups/${fresh.host.groupId}/members/${fresh.members[0]!.id}/sent`, { drawVersion: 1 }, fresh.members[0]!.token);
    expect(r.status).toBe(409);
  });

  it('is never labelled as verification: there is no such state in the API', async () => {
    const s = await drawn();
    const m = s.members[0]!;
    await s.c.post(`/api/groups/${s.host.groupId}/members/${m.id}/sent`, { drawVersion: 1 }, m.token);
    const me = (await s.c.get(`/api/groups/${s.host.groupId}`, m.token)).body.me;
    expect(me.senderState).toBe('user_reports_sent');
    expect(JSON.stringify(await s.c.get(`/api/groups/${s.host.groupId}`, s.host.token))).not.toMatch(/verified/i);
  });
});

describe('recipient acknowledgment', () => {
  it('with the right reference: acknowledged and reference matched; the host sees aggregates only', async () => {
    const s = await drawn();
    const giver = s.members[0]!;
    const recipient = s.recipientOf(giver);
    const ref = s.bundles.get(giver.id)!.reference;
    const r = await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received', reference: ref.replace(/-/g, ' ').toLowerCase() }, recipient.token);
    expect(r.body).toEqual({ recipientState: 'recipient_acknowledged', referenceMatched: true });
    expect(await progress(s)).toMatchObject({ acknowledged: 1, needsAttention: 0 });
    const gv = await s.c.get(`/api/groups/${s.host.groupId}`, s.host.token);
    expect(gv.body.me).toBeUndefined();
    expect(JSON.stringify(gv.body)).not.toContain(recipient.id + '"' + ',"recipient');
    const me = (await s.c.get(`/api/groups/${s.host.groupId}`, recipient.token)).body.me;
    expect(me.recipientState).toBe('recipient_acknowledged');
  });

  it('without a reference: acknowledged, but reference NOT matched (self-report only)', async () => {
    const s = await drawn();
    const recipient = s.members[1]!;
    const r = await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received' }, recipient.token);
    expect(r.body).toEqual({ recipientState: 'recipient_acknowledged', referenceMatched: false });
  });

  it("a reference for someone else's gift (or a random valid one) does not match, and does not acknowledge", async () => {
    const s = await drawn();
    const giver = s.members[0]!;
    const recipient = s.recipientOf(giver);
    const stranger = s.members.find((m) => m.id !== recipient.id && m.id !== giver.id)!;
    const wrongRef = s.bundles.get(stranger.id)!.reference;
    for (const ref of [wrongRef, generateReference()]) {
      const r = await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received', reference: ref }, recipient.token);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('reference_mismatch');
    }
    expect((await progress(s)).acknowledged).toBe(0);
  });

  it('a reference with a typo is rejected up front without consuming an attempt', async () => {
    const s = await drawn();
    const recipient = s.members[1]!;
    for (let i = 0; i < 12; i++) {
      const r = await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received', reference: 'MUM-AAAA-BBBB-CCCC-DDDD-Z' }, recipient.token);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('validation_failed');
    }
    const ok = await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received' }, recipient.token);
    expect(ok.status).toBe(200);
  });

  it('limits wrong (well-formed) references to 10 per hour, then recovers', async () => {
    const s = await drawn();
    const recipient = s.members[1]!;
    const attempt = () => s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received', reference: generateReference() }, recipient.token);
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(422);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    // Even the correct reference is held back while locked out.
    const giver = s.giverOf(recipient);
    const correct = await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received', reference: s.bundles.get(giver.id)!.reference }, recipient.token);
    expect(correct.status).toBe(429);
    // The window is per hour: after it passes, attempts are evaluated again.
    w.clock.advanceMs(3601_000);
    expect((await attempt()).status).toBe(422);
    // Confirming without a reference was never blocked by the lockout.
    expect((await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received' }, recipient.token)).status).toBe(200);
  });

  it('is idempotent: a duplicate acknowledgment never double-counts, even when sent concurrently', async () => {
    const s = await drawn();
    const recipient = s.members[2]!;
    const body = { drawVersion: 1, outcome: 'received' };
    const results = await Promise.all(Array.from({ length: 6 }, () => s.c.post(ackUrl(s.host.groupId, recipient), body, recipient.token)));
    for (const r of results) expect(r.status).toBe(200);
    expect((await progress(s)).acknowledged).toBe(1);
    const stat = await w.db.prepare("SELECT value FROM stats WHERE key = 'gifts_acknowledged'").first<{ value: number }>();
    const before = stat!.value;
    await s.c.post(ackUrl(s.host.groupId, recipient), body, recipient.token);
    expect((await w.db.prepare("SELECT value FROM stats WHERE key = 'gifts_acknowledged'").first<{ value: number }>())!.value).toBe(before);
  });

  it('concurrent duplicate acknowledgments increment the public counter exactly once', async () => {
    const s = await drawn();
    const recipient = s.members[3]!;
    const before = (await w.db.prepare("SELECT value FROM stats WHERE key = 'gifts_acknowledged'").first<{ value: number }>())!.value;
    await Promise.all(Array.from({ length: 8 }, () => s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received' }, recipient.token)));
    const after = (await w.db.prepare("SELECT value FROM stats WHERE key = 'gifts_acknowledged'").first<{ value: number }>())!.value;
    expect(after - before).toBe(1);
  });

  it('a problem report can later be resolved by acknowledging; an acknowledgment cannot be turned into a problem', async () => {
    const s = await drawn();
    const recipient = s.members[0]!;
    const url = ackUrl(s.host.groupId, recipient);
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'problem' }, recipient.token)).body.recipientState).toBe('disputed');
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'problem' }, recipient.token)).status).toBe(200);
    expect(await progress(s)).toMatchObject({ acknowledged: 0, needsAttention: 1 });
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'received' }, recipient.token)).body.recipientState).toBe('recipient_acknowledged');
    expect(await progress(s)).toMatchObject({ acknowledged: 1, needsAttention: 0 });
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'problem' }, recipient.token)).status).toBe(409);
  });

  it('rejects: wrong draw version, a reference with a problem report, "verified", unauthenticated, closed groups', async () => {
    const s = await drawn();
    const recipient = s.members[0]!;
    const url = ackUrl(s.host.groupId, recipient);
    expect((await s.c.post(url, { drawVersion: 9, outcome: 'received' }, recipient.token)).status).toBe(409);
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'problem', reference: generateReference() }, recipient.token)).status).toBe(422);
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'verified' }, recipient.token)).status).toBe(422);
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'received' })).status).toBe(401);
    await s.c.post(`/api/groups/${s.host.groupId}/transition`, { action: 'close' }, s.host.token);
    expect((await s.c.post(url, { drawVersion: 1, outcome: 'received' }, recipient.token)).status).toBe(409);
  });

  it('progress is aggregate-only: no per-member state leaks through any member-visible endpoint', async () => {
    const s = await drawn();
    const giver = s.members[0]!;
    const recipient = s.recipientOf(giver);
    await s.c.post(`/api/groups/${s.host.groupId}/members/${giver.id}/sent`, { drawVersion: 1 }, giver.token);
    await s.c.post(ackUrl(s.host.groupId, recipient), { drawVersion: 1, outcome: 'received' }, recipient.token);
    const observer = s.members.find((m) => m.id !== giver.id && m.id !== recipient.id)!;
    const view = await s.c.get(`/api/groups/${s.host.groupId}`, observer.token);
    expect(view.body.roster.every((r: any) => Object.keys(r).sort().join() === 'addressCommitment,id,pseudonym,status')).toBe(true);
    expect(view.body.me).toMatchObject({ senderState: 'not_started', recipientState: 'not_acknowledged' });
    const text = JSON.stringify(view.body);
    expect(text).not.toContain('user_reports_sent');
    expect(text).not.toContain('recipient_acknowledged');
  });
});

describe('credential rotation (compromised link)', () => {
  it('replaces the token and key, re-seals the assignment, and invalidates the old token', async () => {
    const s = await drawn();
    const m = s.members[0]!;
    const original = s.bundles.get(m.id)!;
    const fresh = await generateKeyPair();
    const newToken = generateToken();
    const sealed = resealAssignment(original, encodeKey(fresh.publicKey));
    const r = await s.c.post(`/api/groups/${s.host.groupId}/members/${m.id}/rotate`, { newTokenHash: hashToken(newToken), newPublicKey: encodeKey(fresh.publicKey), newSealedBundle: sealed, drawVersion: 1 }, m.token);
    expect(r.status).toBe(200);
    expect((await s.c.get(`/api/groups/${s.host.groupId}/members/${m.id}/assignment`, m.token)).status).toBe(401);
    const got = await s.c.get(`/api/groups/${s.host.groupId}/members/${m.id}/assignment`, newToken);
    expect(got.status).toBe(200);
    expect(openAssignment(got.body.sealedBundle, fresh.publicKey, fresh.secretKey, { groupId: s.host.groupId, memberId: m.id, drawVersion: 1 })).toEqual(original);
    // The old key can no longer open the stored bundle.
    expect(() => openAssignment(got.body.sealedBundle, m.keys.publicKey, m.keys.secretKey, { groupId: s.host.groupId, memberId: m.id, drawVersion: 1 })).toThrow();
  });

  it('requires a re-sealed bundle once an assignment exists, and forbids one otherwise', async () => {
    const s = await drawn();
    const m = s.members[0]!;
    const k = await generateKeyPair();
    const body = { newTokenHash: hashToken(generateToken()), newPublicKey: encodeKey(k.publicKey) };
    expect((await s.c.post(`/api/groups/${s.host.groupId}/members/${m.id}/rotate`, body, m.token)).status).toBe(422);
    const pre = await setupGroup(w, 4);
    const pm = pre.members[0]!;
    expect((await pre.c.post(`/api/groups/${pre.host.groupId}/members/${pm.id}/rotate`, { ...body, newSealedBundle: 'a'.repeat(100) }, pm.token)).status).toBe(422);
    expect((await pre.c.post(`/api/groups/${pre.host.groupId}/members/${pm.id}/rotate`, body, pm.token)).status).toBe(200);
  });

  it('two concurrent rotations cannot both succeed; the loser keeps no access', async () => {
    const s = await drawn();
    const m = s.members[0]!;
    const original = s.bundles.get(m.id)!;
    const attempt = async () => {
      const k = await generateKeyPair();
      const token = generateToken();
      const r = await s.c.post(
        `/api/groups/${s.host.groupId}/members/${m.id}/rotate`,
        { newTokenHash: hashToken(token), newPublicKey: encodeKey(k.publicKey), newSealedBundle: resealAssignment(original, encodeKey(k.publicKey)), drawVersion: 1 },
        m.token,
      );
      return { r, token, k };
    };
    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect([a.r.status, b.r.status].sort()).toEqual([200, 409]);
    const winner = a.r.status === 200 ? a : b;
    const loser = a.r.status === 200 ? b : a;
    expect((await s.c.get(`/api/groups/${s.host.groupId}/members/${m.id}/assignment`, loser.token)).status).toBe(401);
    const got = await s.c.get(`/api/groups/${s.host.groupId}/members/${m.id}/assignment`, winner.token);
    expect(got.status).toBe(200);
    expect(openAssignment(got.body.sealedBundle, winner.k.publicKey, winner.k.secretKey, { groupId: s.host.groupId, memberId: m.id, drawVersion: 1 })).toEqual(original);
  });

  it('refuses a token hash already in use in the group, or equal to the current one', async () => {
    const s = await drawn();
    const [a, b] = [s.members[0]!, s.members[1]!];
    const k = await generateKeyPair();
    const sealed = resealAssignment(s.bundles.get(a.id)!, encodeKey(k.publicKey));
    const taken = await s.c.post(`/api/groups/${s.host.groupId}/members/${a.id}/rotate`, { newTokenHash: hashToken(b.token), newPublicKey: encodeKey(k.publicKey), newSealedBundle: sealed, drawVersion: 1 }, a.token);
    expect(taken.status).toBe(409);
    const same = await s.c.post(`/api/groups/${s.host.groupId}/members/${a.id}/rotate`, { newTokenHash: hashToken(a.token), newPublicKey: encodeKey(k.publicKey), newSealedBundle: sealed, drawVersion: 1 }, a.token);
    expect(same.status).toBe(422);
    // The failed attempts changed nothing: the original token still works.
    expect((await s.c.get(`/api/groups/${s.host.groupId}/members/${a.id}/assignment`, a.token)).status).toBe(200);
  });
});

describe('reveals', () => {
  const reveal = (s: Awaited<ReturnType<typeof drawn>>, giver: Participant, recipientId: string, reference: string, audience = 'group') =>
    s.c.post(`/api/groups/${s.host.groupId}/reveals`, { drawVersion: 1, recipientId, reference, audience }, giver.token);

  it('is closed before the reveal date and open from local midnight of that date', async () => {
    const s = await drawn();
    const giver = s.members[0]!;
    const b = s.bundles.get(giver.id)!;
    w.clock.set('2026-12-23T23:59:59.000Z');
    expect((await reveal(s, giver, b.recipient.memberId, b.reference)).status).toBe(403);
    w.clock.set('2026-12-24T00:00:00.000Z');
    expect((await reveal(s, giver, b.recipient.memberId, b.reference)).status).toBe(201);
    expect((await s.c.get(`/api/groups/${s.host.groupId}`, giver.token)).body.group.revealOpen).toBe(true);
  });

  it('requires proof of holding the assignment: wrong reference or wrong person is refused identically and rate-limited', async () => {
    const s = await drawn();
    w.clock.set('2026-12-24T00:00:01.000Z');
    const giver = s.members[0]!;
    const b = s.bundles.get(giver.id)!;
    const other = s.members.find((m) => m.id !== b.recipient.memberId && m.id !== giver.id)!;
    const wrongRef = await reveal(s, giver, b.recipient.memberId, generateReference());
    const wrongPerson = await reveal(s, giver, other.id, b.reference);
    const unknown = await reveal(s, giver, 'f'.repeat(32), b.reference);
    for (const r of [wrongRef, wrongPerson, unknown]) {
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('reference_mismatch');
    }
    expect(wrongPerson.body).toEqual(wrongRef.body);
    expect(unknown.body).toEqual(wrongRef.body);
    for (let i = 0; i < 8; i++) await reveal(s, giver, other.id, generateReference());
    expect((await reveal(s, giver, b.recipient.memberId, b.reference)).status).toBe(429);
    expect(await w.db.prepare('SELECT 1 AS x FROM reveals WHERE group_id = ?1').bind(s.host.groupId).first()).toBeNull();
  });

  it('you cannot reveal yourself, the host cannot reveal, and a recipient cannot claim to be the giver', async () => {
    const s = await drawn();
    w.clock.set('2026-12-24T00:00:01.000Z');
    const giver = s.members[0]!;
    const b = s.bundles.get(giver.id)!;
    expect((await reveal(s, giver, giver.id, b.reference)).status).toBe(422);
    const hostTry = await s.c.post(`/api/groups/${s.host.groupId}/reveals`, { drawVersion: 1, recipientId: b.recipient.memberId, reference: b.reference, audience: 'group' }, s.host.token);
    expect(hostTry.status).toBe(403);
    // The recipient learns the reference from their memo, but a reveal "by" the recipient names the recipient themselves, which is refused.
    const recipient = s.recipientOf(giver);
    expect((await reveal(s, recipient, recipient.id, b.reference)).status).toBe(422);
    // A recipient naming a third party with the reference of their own gift does not match that party's commitment.
    const third = s.members.find((m) => m.id !== recipient.id && m.id !== giver.id)!;
    expect((await reveal(s, recipient, third.id, b.reference)).status).toBe(422);
  });

  it('is idempotent for the same declaration and refuses a second, different one', async () => {
    const s = await drawn();
    w.clock.set('2026-12-24T00:00:01.000Z');
    const giver = s.members[0]!;
    const b = s.bundles.get(giver.id)!;
    expect((await reveal(s, giver, b.recipient.memberId, b.reference)).status).toBe(201);
    const replay = await reveal(s, giver, b.recipient.memberId, b.reference);
    expect(replay.status).toBe(200);
    expect(replay.body.replay).toBe(true);
    expect((await reveal(s, giver, b.recipient.memberId, b.reference, 'recipient')).status).toBe(409);
    const n = await w.db.prepare('SELECT count(*) AS n FROM reveals WHERE group_id = ?1').bind(s.host.groupId).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('audience controls visibility: recipient-only reveals are seen only by the two people involved', async () => {
    const s = await drawn();
    w.clock.set('2026-12-24T00:00:01.000Z');
    const g1 = s.members[0]!;
    const g2 = s.members[1]!;
    const b1 = s.bundles.get(g1.id)!;
    const b2 = s.bundles.get(g2.id)!;
    await reveal(s, g1, b1.recipient.memberId, b1.reference, 'recipient');
    await reveal(s, g2, b2.recipient.memberId, b2.reference, 'group');
    const r1 = s.recipientOf(g1);
    const r2 = s.recipientOf(g2);
    const bystander = s.members.find((m) => ![g1.id, g2.id, r1.id, r2.id].includes(m.id));
    const list = async (t: string) => (await s.c.get(`/api/groups/${s.host.groupId}/reveals`, t)).body.reveals as { giverId: string }[];
    expect((await list(g1.token)).map((x) => x.giverId).sort()).toEqual([g1.id, g2.id].sort());
    expect((await list(r1.token)).map((x) => x.giverId)).toContain(g1.id);
    if (bystander) expect((await list(bystander.token)).map((x) => x.giverId)).toEqual([g2.id]);
    expect((await list(s.host.token)).map((x) => x.giverId)).toEqual([g2.id]); // host sees group-audience reveals only
  });

  it('the host glass box never exposes a recipient-only reveal: not the pair, not the ids, only that one exists', async () => {
    const s = await drawn();
    w.clock.set('2026-12-24T00:00:01.000Z');
    const g1 = s.members[0]!;
    const g2 = s.members[1]!;
    const b1 = s.bundles.get(g1.id)!;
    const b2 = s.bundles.get(g2.id)!;
    await reveal(s, g1, b1.recipient.memberId, b1.reference, 'recipient');
    await reveal(s, g2, b2.recipient.memberId, b2.reference, 'group');
    const gb = (await s.c.get(`/api/groups/${s.host.groupId}/glassbox`, s.host.token)).body;
    // Only the reveal the giver chose to show the whole group is listed, and the same pair-set as the normal host listing.
    expect(gb.reveals.map((r: { giver_member_id: string }) => r.giver_member_id)).toEqual([g2.id]);
    expect(gb.privateRevealCount).toBe(1);
    // The private pair appears nowhere in the response, in any field.
    const wire = JSON.stringify(gb);
    expect(wire).not.toContain(b1.recipient.memberId + '"' + ',"audience":"recipient"');
    expect(wire).not.toContain('"audience":"recipient"');
    // The giver's id of the private reveal can only appear as a roster member and an assignment key, never beside a recipient.
    expect(gb.reveals.some((r: { giver_member_id: string }) => r.giver_member_id === g1.id)).toBe(false);
    // And it matches what the host gets from the ordinary listing.
    const normal = (await s.c.get(`/api/groups/${s.host.groupId}/reveals`, s.host.token)).body.reveals as { giverId: string }[];
    expect(gb.reveals.map((r: { giver_member_id: string }) => r.giver_member_id).sort()).toEqual(normal.map((x) => x.giverId).sort());
  });

  it('only the named recipient can confirm; a stranger cannot', async () => {
    const s = await drawn();
    w.clock.set('2026-12-24T00:00:01.000Z');
    const giver = s.members[0]!;
    const b = s.bundles.get(giver.id)!;
    await reveal(s, giver, b.recipient.memberId, b.reference);
    const recipient = s.recipientOf(giver);
    const stranger = s.members.find((m) => m.id !== recipient.id && m.id !== giver.id)!;
    expect((await s.c.post(`/api/groups/${s.host.groupId}/reveals/${giver.id}/confirm`, {}, stranger.token)).status).toBe(404);
    expect((await s.c.post(`/api/groups/${s.host.groupId}/reveals/${giver.id}/confirm`, {}, giver.token)).status).toBe(404);
    expect((await s.c.post(`/api/groups/${s.host.groupId}/reveals/${giver.id}/confirm`, {}, s.host.token)).status).toBe(403);
    expect((await s.c.post(`/api/groups/${s.host.groupId}/reveals/${giver.id}/confirm`, {}, recipient.token)).status).toBe(200);
    expect((await s.c.post(`/api/groups/${s.host.groupId}/reveals/${giver.id}/confirm`, {}, recipient.token)).status).toBe(200);
    const list = (await s.c.get(`/api/groups/${s.host.groupId}/reveals`, stranger.token)).body.reveals;
    expect(list[0].confirmedByRecipient).toBe(true);
  });

  it('private assignments stay private: with no reveal, no pair is stored or returned anywhere', async () => {
    const s = await drawn();
    w.clock.set('2026-12-25T00:00:00.000Z');
    expect((await s.c.get(`/api/groups/${s.host.groupId}/reveals`, s.members[0]!.token)).body.reveals).toEqual([]);
    const dump = JSON.stringify((await s.c.get(`/api/groups/${s.host.groupId}/glassbox`, s.host.token)).body);
    for (const m of s.members) {
      const b = s.bundles.get(m.id)!;
      expect(dump).not.toContain(b.reference);
    }
    expect(await w.db.prepare('SELECT 1 AS x FROM reveals WHERE group_id = ?1').bind(s.host.groupId).first()).toBeNull();
  });

  it('a redraw reset removes reveals along with the draw', async () => {
    const s = await drawn();
    w.clock.set('2026-12-24T00:00:01.000Z');
    const giver = s.members[0]!;
    const b = s.bundles.get(giver.id)!;
    await reveal(s, giver, b.recipient.memberId, b.reference);
    expect((await s.c.post(`/api/groups/${s.host.groupId}/transition`, { action: 'reset_draw' }, s.host.token)).body.state).toBe('locked');
    expect(await w.db.prepare('SELECT 1 AS x FROM reveals WHERE group_id = ?1').bind(s.host.groupId).first()).toBeNull();
  });
});
