import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeKey, generateKeyPair, generateToken, hashToken, openAssignment, resealAssignment } from '@mummer/crypto';
import { createWorld, drawGroup, openOwnAssignment, setupGroup, type Participant, type World } from './harness.js';
import { interleaveBeforeBatch } from './interleave.js';

/**
 * Cross-operation races. Each test lets a handler finish all of its reads and checks, then makes a competing operation
 * (a draw, a reset and redraw, a close) complete BEFORE the handler writes. The write must then change nothing and answer
 * with a conflict. These were found by review as inferred defects; the tests make the interleaving deterministic.
 */

let w: World;
let restore: (() => void) | undefined;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterEach(() => {
  restore?.();
  restore = undefined;
});
afterAll(async () => {
  await w.dispose();
});

type Setup = Awaited<ReturnType<typeof setupGroup>>;
const gid = (s: Setup) => s.host.groupId;

async function drawnGroup(n = 5) {
  const s = await setupGroup(w, n);
  const d = await drawGroup(w, s.c, s.host, s.members);
  expect(d.res.status).toBe(201);
  const bundles = new Map<string, Awaited<ReturnType<typeof openOwnAssignment>>>();
  for (const m of s.members) bundles.set(m.id, await openOwnAssignment(s.c, gid(s), m));
  return { ...s, bundles, recipientOf: (g: Participant) => s.members.find((x) => x.id === bundles.get(g.id)!.recipient.memberId)! };
}

/** Reset the draw and draw again (draw version 2), exactly what a host does to fix a mistake. */
async function redraw(s: Setup) {
  expect((await s.c.post(`/api/groups/${gid(s)}/transition`, { action: 'reset_draw' }, s.host.token)).status).toBe(200);
  const d = await drawGroup(w, s.c, s.host, s.members, { version: 2 });
  expect(d.res.status).toBe(201);
}

const one = async <T>(sql: string, ...args: unknown[]) => (await w.db.prepare(sql).bind(...args).first<T>()) ?? undefined;
const stat = async (key: string) => (await one<{ value: number }>('SELECT value FROM stats WHERE key = ?1', key))?.value ?? 0;

describe('link replacement versus the draw', () => {
  it('a replacement checked before the draw cannot install a new key after the draw sealed to the old one', async () => {
    const s = await setupGroup(w, 4);
    const m = s.members[0]!;
    const fresh = await generateKeyPair();
    const newToken = generateToken();
    restore = interleaveBeforeBatch(w, 'UPDATE members SET token_hash', async () => {
      const d = await drawGroup(w, s.c, s.host, s.members); // commits with m's OLD public key
      expect(d.res.status).toBe(201);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/rotate`, { newTokenHash: hashToken(newToken), newPublicKey: encodeKey(fresh.publicKey) }, m.token);
    restore();
    restore = undefined;
    expect(r.status).toBe(409);
    // Nothing changed: the old token still works and the old key still opens the assignment the draw just made.
    const stored = await one<{ token_hash: string; public_key: string }>('SELECT token_hash, public_key FROM members WHERE group_id = ?1 AND id = ?2', gid(s), m.id);
    expect(stored?.token_hash).toBe(hashToken(m.token));
    expect(stored?.public_key).toBe(encodeKey(m.keys.publicKey));
    expect((await s.c.get(`/api/groups/${gid(s)}/members/${m.id}/assignment`, newToken)).status).toBe(401);
    const opened = await openOwnAssignment(s.c, gid(s), m);
    expect(opened.giverId).toBe(m.id);
  });

  it('after the 409 the member can open the assignment and replace the link properly', async () => {
    const s = await setupGroup(w, 4);
    const m = s.members[0]!;
    restore = interleaveBeforeBatch(w, 'UPDATE members SET token_hash', async () => {
      await drawGroup(w, s.c, s.host, s.members);
    });
    const k1 = await generateKeyPair();
    expect((await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/rotate`, { newTokenHash: hashToken(generateToken()), newPublicKey: encodeKey(k1.publicKey) }, m.token)).status).toBe(409);
    restore();
    restore = undefined;
    const bundle = await openOwnAssignment(s.c, gid(s), m);
    const k2 = await generateKeyPair();
    const token2 = generateToken();
    const ok = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/rotate`, { newTokenHash: hashToken(token2), newPublicKey: encodeKey(k2.publicKey), newSealedBundle: resealAssignment(bundle, encodeKey(k2.publicKey)), drawVersion: 1 }, m.token);
    expect(ok.status).toBe(200);
    const got = await s.c.get(`/api/groups/${gid(s)}/members/${m.id}/assignment`, token2);
    expect(openAssignment(got.body.sealedBundle, k2.publicKey, k2.secretKey, { groupId: gid(s), memberId: m.id, drawVersion: 1 }).giverId).toBe(m.id);
  });

  it('a bundle re-sealed from an earlier draw cannot overwrite the current draw’s assignment', async () => {
    const s = await drawnGroup(5);
    const m = s.members[0]!;
    const oldBundle = s.bundles.get(m.id)!; // draw version 1
    await redraw(s); // now version 2
    const k = await generateKeyPair();
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/rotate`, { newTokenHash: hashToken(generateToken()), newPublicKey: encodeKey(k.publicKey), newSealedBundle: resealAssignment(oldBundle, encodeKey(k.publicKey)), drawVersion: 1 }, m.token);
    expect(r.status).toBe(409);
    const stored = await one<{ draw_version: number }>('SELECT draw_version FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2', gid(s), m.id);
    expect(stored?.draw_version).toBe(2);
    const current = await openOwnAssignment(s.c, gid(s), m, 2);
    expect(current.drawVersion).toBe(2);
  });

  it('a redraw that lands between the check and the write also changes nothing', async () => {
    const s = await drawnGroup(5);
    const m = s.members[0]!;
    const oldBundle = s.bundles.get(m.id)!;
    const k = await generateKeyPair();
    restore = interleaveBeforeBatch(w, 'UPDATE members SET token_hash', async () => {
      await redraw(s);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/rotate`, { newTokenHash: hashToken(generateToken()), newPublicKey: encodeKey(k.publicKey), newSealedBundle: resealAssignment(oldBundle, encodeKey(k.publicKey)), drawVersion: 1 }, m.token);
    expect(r.status).toBe(409);
    expect((await one<{ public_key: string }>('SELECT public_key FROM members WHERE group_id = ?1 AND id = ?2', gid(s), m.id))?.public_key).toBe(encodeKey(m.keys.publicKey));
    expect((await openOwnAssignment(s.c, gid(s), m, 2)).drawVersion).toBe(2);
  });
});

describe('payment writes versus a redraw', () => {
  it('a delayed "I sent it" from draw 1 cannot mark draw 2 as sent or activate the group', async () => {
    const s = await drawnGroup(5);
    const m = s.members[0]!;
    restore = interleaveBeforeBatch(w, 'UPDATE members SET sender_state', async () => {
      await redraw(s);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/sent`, { drawVersion: 1 }, m.token);
    expect(r.status).toBe(409);
    expect((await one<{ sender_state: string }>('SELECT sender_state FROM members WHERE group_id = ?1 AND id = ?2', gid(s), m.id))?.sender_state).toBe('not_started');
    expect((await one<{ state: string }>('SELECT state FROM groups WHERE id = ?1', gid(s)))?.state).toBe('drawn');
  });

  it('a delayed "I sent it" after the host closed the exchange changes nothing', async () => {
    const s = await drawnGroup(5);
    const m = s.members[0]!;
    restore = interleaveBeforeBatch(w, 'UPDATE members SET sender_state', async () => {
      expect((await s.c.post(`/api/groups/${gid(s)}/transition`, { action: 'close' }, s.host.token)).status).toBe(200);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/sent`, { drawVersion: 1 }, m.token);
    expect(r.status).toBe(409);
    expect((await one<{ sender_state: string }>('SELECT sender_state FROM members WHERE group_id = ?1 AND id = ?2', gid(s), m.id))?.sender_state).toBe('not_started');
  });

  it('a repeated "I sent it" is still a success (idempotent), not a conflict', async () => {
    const s = await drawnGroup(5);
    const m = s.members[0]!;
    const url = `/api/groups/${gid(s)}/members/${m.id}/sent`;
    expect((await s.c.post(url, { drawVersion: 1 }, m.token)).status).toBe(200);
    expect((await s.c.post(url, { drawVersion: 1 }, m.token)).status).toBe(200);
  });

  it('a delayed acknowledgment checked against draw 1 cannot confirm draw 2 and does not count', async () => {
    const s = await drawnGroup(5);
    const giver = s.members[0]!;
    const recipient = s.recipientOf(giver);
    const reference = s.bundles.get(giver.id)!.reference;
    const before = await stat('gifts_acknowledged');
    restore = interleaveBeforeBatch(w, 'UPDATE ack_commitments SET state', async () => {
      await redraw(s);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${recipient.id}/ack`, { drawVersion: 1, outcome: 'received', reference }, recipient.token);
    expect(r.status).toBe(409);
    const row = await one<{ state: string; draw_version: number }>('SELECT state, draw_version FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2', gid(s), recipient.id);
    expect(row?.draw_version).toBe(2);
    expect(row?.state).toBe('not_acknowledged');
    expect(await stat('gifts_acknowledged')).toBe(before);
  });

  it('a delayed "there was a problem" report from draw 1 cannot flag draw 2', async () => {
    const s = await drawnGroup(5);
    const recipient = s.members[1]!;
    restore = interleaveBeforeBatch(w, 'UPDATE ack_commitments SET state', async () => {
      await redraw(s);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${recipient.id}/ack`, { drawVersion: 1, outcome: 'problem' }, recipient.token);
    expect(r.status).toBe(409);
    expect((await one<{ state: string }>('SELECT state FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2', gid(s), recipient.id))?.state).toBe('not_acknowledged');
  });

  it('an acknowledgment after the host closed the exchange changes nothing', async () => {
    const s = await drawnGroup(5);
    const giver = s.members[0]!;
    const recipient = s.recipientOf(giver);
    const reference = s.bundles.get(giver.id)!.reference;
    restore = interleaveBeforeBatch(w, 'UPDATE ack_commitments SET state', async () => {
      await s.c.post(`/api/groups/${gid(s)}/transition`, { action: 'close' }, s.host.token);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${recipient.id}/ack`, { drawVersion: 1, outcome: 'received', reference }, recipient.token);
    expect(r.status).toBe(409);
    expect((await one<{ state: string }>('SELECT state FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2', gid(s), recipient.id))?.state).toBe('not_acknowledged');
  });

  it('a repeated acknowledgment is still a success and counts once', async () => {
    const s = await drawnGroup(5);
    const giver = s.members[0]!;
    const recipient = s.recipientOf(giver);
    const reference = s.bundles.get(giver.id)!.reference;
    const before = await stat('gifts_acknowledged');
    const body = { drawVersion: 1, outcome: 'received', reference };
    expect((await s.c.post(`/api/groups/${gid(s)}/members/${recipient.id}/ack`, body, recipient.token)).status).toBe(200);
    expect((await s.c.post(`/api/groups/${gid(s)}/members/${recipient.id}/ack`, body, recipient.token)).status).toBe(200);
    expect(await stat('gifts_acknowledged')).toBe(before + 1);
  });
});

describe('leaving versus the draw', () => {
  it('a leave that was about to delete the member, when a draw commits first, revokes them instead of reporting a removal that did not happen', async () => {
    const s = await setupGroup(w, 5);
    const m = s.members[0]!;
    restore = interleaveBeforeBatch(w, 'DELETE FROM members', async () => {
      expect((await drawGroup(w, s.c, s.host, s.members)).res.status).toBe(201);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/leave`, {}, m.token);
    restore();
    restore = undefined;
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ left: true, exception: true }); // the response matches what actually happened
    expect((await one<{ status: string }>('SELECT status FROM members WHERE group_id = ?1 AND id = ?2', gid(s), m.id))?.status).toBe('revoked');
    expect((await one<{ state: string }>('SELECT state FROM groups WHERE id = ?1', gid(s)))?.state).toBe('needs_resolution');
    const types = (await w.db.prepare('SELECT type FROM audit_events WHERE group_id = ?1').bind(gid(s)).all<{ type: string }>()).results.map((e) => e.type);
    expect(types).toContain('member_revoked_after_draw');
    expect(types).not.toContain('member_removed'); // no false "removed" event
    expect((await s.c.get(`/api/groups/${gid(s)}/members/${m.id}/assignment`, m.token)).status).toBe(401);
  });

  it('a normal pre-draw leave removes the member, bumps the members version and logs one event', async () => {
    const s = await setupGroup(w, 5);
    const m = s.members[1]!;
    const before = await one<{ members_version: number }>('SELECT members_version FROM groups WHERE id = ?1', gid(s));
    const r = await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/leave`, {}, m.token);
    expect(r.body).toEqual({ left: true, exception: false });
    expect(await one('SELECT 1 AS x FROM members WHERE group_id = ?1 AND id = ?2', gid(s), m.id)).toBeUndefined();
    expect((await one<{ members_version: number }>('SELECT members_version FROM groups WHERE id = ?1', gid(s)))?.members_version).toBe(before!.members_version + 1);
    const removed = (await w.db.prepare("SELECT count(*) AS n FROM audit_events WHERE group_id = ?1 AND type = 'member_removed'").bind(gid(s)).first<{ n: number }>())?.n;
    expect(removed).toBe(1);
  });

  it('a repeated post-draw leave writes no second event', async () => {
    const s = await drawnGroup(5);
    const m = s.members[2]!;
    expect((await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/leave`, {}, m.token)).status).toBe(200);
    // The token is dead after the first leave, so a repeat is refused; the audit log still holds exactly one event.
    expect((await s.c.post(`/api/groups/${gid(s)}/members/${m.id}/leave`, {}, m.token)).status).toBe(401);
    const n = (await w.db.prepare("SELECT count(*) AS n FROM audit_events WHERE group_id = ?1 AND type = 'member_revoked_after_draw'").bind(gid(s)).first<{ n: number }>())?.n;
    expect(n).toBe(1);
  });
});

describe('reveals versus a redraw or a close', () => {
  async function atRevealDay() {
    const s = await drawnGroup(5);
    w.clock.set('2026-12-24T00:00:01.000Z');
    const giver = s.members[0]!;
    const recipient = s.recipientOf(giver);
    const reference = s.bundles.get(giver.id)!.reference;
    return { ...s, giver, recipient, reference };
  }

  it('a reveal checked against draw 1 is refused if the draw was redone before it was written', async () => {
    const s = await atRevealDay();
    restore = interleaveBeforeBatch(w, 'INSERT INTO reveals', async () => {
      await redraw(s);
    });
    const r = await s.c.post(`/api/groups/${gid(s)}/reveals`, { drawVersion: 1, recipientId: s.recipient.id, reference: s.reference, audience: 'group' }, s.giver.token);
    expect(r.status).toBe(409);
    expect(await one('SELECT 1 AS x FROM reveals WHERE group_id = ?1', gid(s))).toBeUndefined();
    const events = (await w.db.prepare("SELECT count(*) AS n FROM audit_events WHERE group_id = ?1 AND type = 'reveal_declared'").bind(gid(s)).first<{ n: number }>())?.n;
    expect(events).toBe(0);
  });

  it('a recipient cannot confirm a reveal after the host closed the exchange', async () => {
    const s = await atRevealDay();
    const ok = await s.c.post(`/api/groups/${gid(s)}/reveals`, { drawVersion: 1, recipientId: s.recipient.id, reference: s.reference, audience: 'group' }, s.giver.token);
    expect(ok.status).toBe(201);
    expect((await s.c.post(`/api/groups/${gid(s)}/transition`, { action: 'close' }, s.host.token)).status).toBe(200);
    const r = await s.c.post(`/api/groups/${gid(s)}/reveals/${s.giver.id}/confirm`, {}, s.recipient.token);
    expect(r.status).toBe(409);
    expect((await one<{ recipient_confirmed_day: string | null }>('SELECT recipient_confirmed_day FROM reveals WHERE group_id = ?1', gid(s)))?.recipient_confirmed_day).toBeNull();
  });

  it('before the close, confirmation still works', async () => {
    const s = await atRevealDay();
    expect((await s.c.post(`/api/groups/${gid(s)}/reveals`, { drawVersion: 1, recipientId: s.recipient.id, reference: s.reference, audience: 'group' }, s.giver.token)).status).toBe(201);
    expect((await s.c.post(`/api/groups/${gid(s)}/reveals/${s.giver.id}/confirm`, {}, s.recipient.token)).status).toBe(200);
  });
});
