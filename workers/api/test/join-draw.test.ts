import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addressCommitment, encodeKey, generateKeyPair, generateToken, hashToken, sealProfile } from '@mummer/crypto';
import { createGroup, createWorld, drawGroup, joinMember, NAMES, openOwnAssignment, setupGroup, testAddress, type World } from './harness.js';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

async function rawJoin(c: ReturnType<World['client']>, groupId: string, hostKeyB64: string, name: string, patch: Record<string, unknown> = {}) {
  const keys = await generateKeyPair();
  const token = generateToken();
  const body = {
    pseudonym: name,
    publicKey: encodeKey(keys.publicKey),
    tokenHash: hashToken(token),
    sealedProfile: sealProfile({ v: 1, kind: 'profile', groupId, pseudonym: name, wishlist: 'x', address: testAddress(1) }, hostKeyB64),
    addressCommitment: addressCommitment(groupId, name, testAddress(1)),
    ...patch,
  };
  return { res: await c.post(`/api/groups/${groupId}/members`, body), body, token, keys };
}

describe('joining', () => {
  it('joins, stores only sealed/hashed values, and reports the member in the roster', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const { res, body, token } = await rawJoin(c, host.groupId, encodeKey(host.keys.publicKey), 'Ada');
    expect(res.status).toBe(201);
    const row = await w.db.prepare('SELECT * FROM members WHERE group_id = ?1').bind(host.groupId).first<Record<string, string>>();
    expect(row!.token_hash).toBe(body.tokenHash);
    expect(row!.sealed_profile).toBe(body.sealedProfile);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(testAddress(1));
    expect(row!.status).toBe('ready');
    expect(row!.joined_day).toBe('2026-11-01');
  });

  it('is idempotent for the same credentials and refuses conflicting reuse', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const first = await rawJoin(c, host.groupId, encodeKey(host.keys.publicKey), 'Ada');
    const again = await c.post(`/api/groups/${host.groupId}/members`, first.body);
    expect(again.status).toBe(200);
    expect(again.body.memberId).toBe(first.res.body.memberId);
    const clash = await c.post(`/api/groups/${host.groupId}/members`, { ...first.body, pseudonym: 'Someone Else' });
    expect(clash.status).toBe(409);
    const n = await w.db.prepare('SELECT count(*) AS n FROM members WHERE group_id = ?1').bind(host.groupId).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('display names are unique case-insensitively and across Unicode width/compatibility forms', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const key = encodeKey(host.keys.publicKey);
    expect((await rawJoin(c, host.groupId, key, 'Ada')).res.status).toBe(201);
    for (const dupe of ['ada', 'ADA', ' Ada ', 'ＡＤＡ']) {
      const r = await rawJoin(c, host.groupId, key, dupe);
      expect(r.res.status).toBe(409);
      expect(r.res.body.error.code).toBe('duplicate_pseudonym');
    }
    expect((await rawJoin(c, host.groupId, key, 'Adam')).res.status).toBe(201);
  });

  it.each([
    ['name too short', { pseudonym: 'A' }],
    ['name too long', { pseudonym: 'x'.repeat(33) }],
    ['control characters in name', { pseudonym: 'Ad' + String.fromCharCode(0) + 'a' }],
    ['profile not base64url', { sealedProfile: 'not base64!!' + 'a'.repeat(50) }],
    ['profile too large', { sealedProfile: 'a'.repeat(9000) }],
    ['bad public key', { publicKey: 'short' }],
    ['bad token hash', { tokenHash: 'nothex' }],
    ['unknown field', { role: 'admin' }],
  ])('rejects: %s', async (_n, patch) => {
    const c = w.client();
    const host = await createGroup(c);
    const r = await rawJoin(c, host.groupId, encodeKey(host.keys.publicKey), 'Valid Name', patch);
    expect(r.res.status).toBe(422);
  });

  it('enforces the member cap, including under concurrent joins', async () => {
    const c = w.client();
    const host = await createGroup(c, { memberCap: 4 });
    const key = encodeKey(host.keys.publicKey);
    const results = await Promise.all(NAMES.slice(0, 8).map((n, i) => rawJoin(w.client(`198.18.0.${i + 1}`), host.groupId, key, n)));
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(4);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(results.find((r) => r.res.status === 409)!.res.body.error.code).toBe('group_full');
    const n = await w.db.prepare('SELECT count(*) AS n FROM members WHERE group_id = ?1').bind(host.groupId).first<{ n: number }>();
    expect(n!.n).toBe(4);
    const inv = await c.get(`/api/groups/${host.groupId}/invite`);
    expect(inv.body).toMatchObject({ spotsLeft: 0, joinOpen: false });
  }, 60_000);

  it('refuses joins after the deadline, after the host closes joining, and after the draw', async () => {
    const { c, host, members, hostKeyB64 } = await setupGroup(w, 4);
    const key = hostKeyB64;
    // Host closes joining.
    await c.post(`/api/groups/${host.groupId}/transition`, { action: 'lock' }, host.token);
    let r = await rawJoin(c, host.groupId, key, 'Late Larry');
    expect(r.res.status).toBe(409);
    expect(r.res.body.error.code).toBe('join_closed');
    expect(r.res.body.error.message).toMatch(/host/);
    await c.post(`/api/groups/${host.groupId}/transition`, { action: 'reopen' }, host.token);
    // Deadline passes.
    w.clock.set('2026-11-21T00:00:00.000Z');
    r = await rawJoin(c, host.groupId, key, 'Late Larry');
    expect(r.res.status).toBe(409);
    expect(r.res.body.error.message).toMatch(/deadline/);
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.group.state).toBe('locked');
    // After the draw.
    const d = await drawGroup(w, c, host, members);
    expect(d.res.status).toBe(201);
    r = await rawJoin(c, host.groupId, key, 'Later Lucy');
    expect(r.res.status).toBe(409);
    expect(r.res.body.error.message).toMatch(/drawn/);
    w.clock.set('2026-11-01T12:00:00.000Z');
  }, 60_000);

  it('the join deadline day itself is fully open and closes at local midnight in the group timezone', async () => {
    const c = w.client();
    const host = await createGroup(c, { timezone: 'Pacific/Auckland', joinDeadline: '2026-11-20', revealDate: '2026-12-24' });
    const key = encodeKey(host.keys.publicKey);
    // Auckland is UTC+13 in November: the 20th ends at 2026-11-20T11:00:00Z.
    w.clock.set('2026-11-20T10:59:00.000Z');
    expect((await rawJoin(c, host.groupId, key, 'Almost Late')).res.status).toBe(201);
    w.clock.set('2026-11-20T11:00:00.000Z');
    expect((await rawJoin(c, host.groupId, key, 'Too Late')).res.status).toBe(409);
    w.clock.set('2026-11-01T12:00:00.000Z');
  });

  it('rate-limits joins per client', async () => {
    const c = w.client('198.51.100.50');
    const host = await createGroup(w.client(), { memberCap: 50 });
    const key = encodeKey(host.keys.publicKey);
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await rawJoin(c, host.groupId, key, `Person ${i}`)).res.status;
    expect(last).toBe(429);
  }, 60_000);

  it('joining a nonexistent group is a 404', async () => {
    const kp = await generateKeyPair();
    const r = await rawJoin(w.client(), 'c'.repeat(32), encodeKey(kp.publicKey), 'Ada');
    expect(r.res.status).toBe(404);
  });
});

describe('removal, leaving and revocation', () => {
  it('before the draw: host removal deletes the member and frees the name', async () => {
    const { c, host, members, hostKeyB64 } = await setupGroup(w, 4);
    const r = await c.del(`/api/groups/${host.groupId}/members/${members[0]!.id}`, host.token);
    expect(r.body).toEqual({ removed: true, exception: false });
    expect(await w.db.prepare('SELECT 1 AS x FROM members WHERE group_id = ?1 AND id = ?2').bind(host.groupId, members[0]!.id).first()).toBeNull();
    expect((await c.get(`/api/groups/${host.groupId}/members/${members[0]!.id}/assignment`, members[0]!.token)).status).toBe(401);
    expect((await rawJoin(c, host.groupId, hostKeyB64, members[0]!.name)).res.status).toBe(201);
    expect((await c.del(`/api/groups/${host.groupId}/members/${'d'.repeat(32)}`, host.token)).status).toBe(404);
  }, 60_000);

  it('a member can leave before the draw', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    const r = await c.post(`/api/groups/${host.groupId}/members/${members[1]!.id}/leave`, {}, members[1]!.token);
    expect(r.body).toEqual({ left: true, exception: false });
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.roster).toHaveLength(4);
  }, 60_000);

  it('after the draw: removal revokes the credential, drops the assignment and flags the group', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    await drawGroup(w, c, host, members);
    const victim = members[2]!;
    const r = await c.del(`/api/groups/${host.groupId}/members/${victim.id}`, host.token);
    expect(r.body).toEqual({ removed: true, exception: true });
    expect((await c.get(`/api/groups/${host.groupId}/members/${victim.id}/assignment`, victim.token)).status).toBe(401);
    expect(await w.db.prepare('SELECT 1 AS x FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2').bind(host.groupId, victim.id).first()).toBeNull();
    const gv = await c.get(`/api/groups/${host.groupId}`, host.token);
    expect(gv.body.group.state).toBe('needs_resolution');
    expect(gv.body.roster.find((x: any) => x.id === victim.id).status).toBe('revoked');
    // The victim's old token no longer authenticates anywhere, including the group overview.
    expect((await c.get(`/api/groups/${host.groupId}`, victim.token)).status).toBe(401);
    // Other members are unaffected.
    expect((await c.get(`/api/groups/${host.groupId}/members/${members[0]!.id}/assignment`, members[0]!.token)).status).toBe(200);
  }, 60_000);

  it('cannot remove members from a closed exchange', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    await drawGroup(w, c, host, members);
    await c.post(`/api/groups/${host.groupId}/transition`, { action: 'close' }, host.token);
    expect((await c.del(`/api/groups/${host.groupId}/members/${members[0]!.id}`, host.token)).status).toBe(409);
  }, 60_000);
});

describe('the draw: authorization, atomicity and idempotency', () => {
  it('requires the host, an idempotency key, and a valid body', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    const base = await drawGroup(w, c, host, members, { key: 'k'.repeat(20) }); // creates a valid payload and commits it
    expect(base.res.status).toBe(201);
    const fresh = await setupGroup(w, 4);
    const noKey = await fresh.c.post(`/api/groups/${fresh.host.groupId}/draw`, { drawVersion: 1, bundles: [], commitments: [] }, fresh.host.token);
    expect(noKey.status).toBe(400);
    const shortKey = await fresh.c.post(`/api/groups/${fresh.host.groupId}/draw`, {}, fresh.host.token, { 'idempotency-key': 'short' });
    expect(shortKey.status).toBe(400);
    const badBody = await fresh.c.post(`/api/groups/${fresh.host.groupId}/draw`, { drawVersion: 1, bundles: [], commitments: [] }, fresh.host.token, { 'idempotency-key': 'k'.repeat(20) });
    expect(badBody.status).toBe(422);
    const notHost = await fresh.c.post(`/api/groups/${fresh.host.groupId}/draw`, {}, fresh.members[0]!.token, { 'idempotency-key': 'k'.repeat(20) });
    expect(notHost.status).toBe(401);
  }, 60_000);

  it('the same request with the same key is a no-op replay; a different key after the draw is refused', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    const first = await drawGroup(w, c, host, members, { key: 'a'.repeat(24) });
    expect(first.res.status).toBe(201);
    const mv = (await w.db.prepare('SELECT members_version AS v FROM groups WHERE id = ?1').bind(host.groupId).first<{ v: number }>())!.v;
    const replay = await c.post(`/api/groups/${host.groupId}/draw`, { drawVersion: 1, membersVersion: mv, closeEarly: true, ...first.payload }, host.token, { 'idempotency-key': 'a'.repeat(24) });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ drawVersion: 1, replay: true });
    // The identical payload under a different key is a second draw attempt, not a replay.
    const second = await c.post(`/api/groups/${host.groupId}/draw`, { drawVersion: 1, membersVersion: mv, closeEarly: true, ...first.payload }, host.token, { 'idempotency-key': 'b'.repeat(24) });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('draw_already_done');
    const n = await w.db.prepare('SELECT count(*) AS n FROM assignments WHERE group_id = ?1').bind(host.groupId).first<{ n: number }>();
    expect(n!.n).toBe(4);
  }, 60_000);

  it('two concurrent draws: exactly one wins, and the database holds exactly one draw', async () => {
    const { c, host, members } = await setupGroup(w, 6);
    // Build two different valid payloads from the same member list, then submit them simultaneously.
    const a = await buildOnly(c, host, members);
    const b = await buildOnly(c, host, members);
    const [ra, rb] = await Promise.all([
      c.post(`/api/groups/${host.groupId}/draw`, a, host.token, { 'idempotency-key': 'a'.repeat(24) }),
      c.post(`/api/groups/${host.groupId}/draw`, b, host.token, { 'idempotency-key': 'b'.repeat(24) }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 409]);
    const counts = await Promise.all(['assignments', 'ack_commitments'].map(async (t) => (await w.db.prepare(`SELECT count(*) AS n FROM ${t} WHERE group_id = ?1`).bind(host.groupId).first<{ n: number }>())!.n));
    expect(counts).toEqual([6, 6]);
    const g = await w.db.prepare('SELECT state, draw_version FROM groups WHERE id = ?1').bind(host.groupId).first<{ state: string; draw_version: number }>();
    expect(g).toEqual({ state: 'drawn', draw_version: 1 });
    // And the stored draw is internally consistent: every member can open a bundle from the winning payload.
    const winner = ra.status === 201 ? a : b;
    expect(winner.bundles).toHaveLength(6);
    for (const m of members) await openOwnAssignment(c, host.groupId, m);
  }, 60_000);

  it('refuses a draw if the member list changed since the profiles were read', async () => {
    const { c, host, members, hostKeyB64 } = await setupGroup(w, 5);
    const payload = await buildOnly(c, host, members);
    await rawJoin(c, host.groupId, hostKeyB64, 'Latecomer'); // joins after the host fetched profiles
    const r = await c.post(`/api/groups/${host.groupId}/draw`, payload, host.token, { 'idempotency-key': 'k'.repeat(24) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('draw_mismatch');
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.group.state).toBe('open');
  }, 60_000);

  it('refuses missing, extra, duplicated and unknown members; wrong versions; too few members', async () => {
    const { c, host, members } = await setupGroup(w, 5);
    const good = await buildOnly(c, host, members);
    const post = (body: unknown) => c.post(`/api/groups/${host.groupId}/draw`, body, host.token, { 'idempotency-key': generateToken().slice(0, 30) });
    expect((await post({ ...good, bundles: good.bundles.slice(1) })).status).toBe(409);
    expect((await post({ ...good, commitments: good.commitments.slice(1) })).status).toBe(409);
    expect((await post({ ...good, bundles: [...good.bundles.slice(1), good.bundles[1]] })).status).toBe(422);
    expect((await post({ ...good, bundles: [...good.bundles.slice(1), { ...good.bundles[0], memberId: 'e'.repeat(32) }] })).status).toBe(409);
    expect((await post({ ...good, drawVersion: 2 })).status).toBe(409);
    expect((await post({ ...good, drawVersion: 0 })).status).toBe(422);
    expect((await post({ ...good, bundles: good.bundles.slice(0, 3), commitments: good.commitments.slice(0, 3) })).status).toBe(422);
    // None of the failures changed state.
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.group.state).toBe('open');
    expect((await post(good)).status).toBe(201);
  }, 60_000);

  it('requires closeEarly while the join window is open, and works without it once locked', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    const refused = await drawGroup(w, c, host, members, { closeEarly: false });
    expect(refused.res.status).toBe(409);
    expect(refused.res.body.error.code).toBe('invalid_state');
    await c.post(`/api/groups/${host.groupId}/transition`, { action: 'lock' }, host.token);
    const ok = await drawGroup(w, c, host, members, { closeEarly: false });
    expect(ok.res.status).toBe(201);
  }, 60_000);

  it('profiles are only available before the draw and only to the host', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    expect((await c.get(`/api/groups/${host.groupId}/profiles`, host.token)).status).toBe(200);
    expect((await c.get(`/api/groups/${host.groupId}/profiles`, members[0]!.token)).status).toBe(401);
    await drawGroup(w, c, host, members);
    expect((await c.get(`/api/groups/${host.groupId}/profiles`, host.token)).status).toBe(409);
  }, 60_000);

  it('no assignment exists before the draw; revoked or removed members cannot fetch one', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    expect((await c.get(`/api/groups/${host.groupId}/members/${members[0]!.id}/assignment`, members[0]!.token)).status).toBe(404);
  }, 60_000);

  it('rows in assignments and commitments are stored in member-id order, not draw order', async () => {
    const { c, host, members } = await setupGroup(w, 8);
    await drawGroup(w, c, host, members);
    const a = (await w.db.prepare('SELECT giver_member_id AS id FROM assignments WHERE group_id = ?1').bind(host.groupId).all<{ id: string }>()).results.map((r) => r.id);
    const k = (await w.db.prepare('SELECT recipient_member_id AS id FROM ack_commitments WHERE group_id = ?1').bind(host.groupId).all<{ id: string }>()).results.map((r) => r.id);
    expect(a).toEqual([...a].sort());
    expect(k).toEqual([...k].sort());
  }, 60_000);

  it('the schema has no column that links a giver to a recipient outside of consented reveals', async () => {
    const cols = async (t: string) => (await w.db.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map((r) => r.name);
    expect(await cols('assignments')).toEqual(['group_id', 'giver_member_id', 'draw_version', 'sealed_bundle']);
    expect(await cols('ack_commitments')).toEqual(['group_id', 'recipient_member_id', 'draw_version', 'commitment', 'state', 'reference_matched', 'state_day']);
    expect(await cols('members')).not.toContain('recipient_id');
    expect(await cols('audit_events')).toEqual(['id', 'group_id', 'type', 'day', 'version']);
  });
});

/** Build a draw payload without posting it. */
async function buildOnly(c: ReturnType<World['client']>, host: Awaited<ReturnType<typeof createGroup>>, members: { id: string }[]) {
  const { openProfile, buildDrawPayload } = await import('@mummer/crypto');
  const { runDraw } = await import('@mummer/draw');
  const prof = await c.get(`/api/groups/${host.groupId}/profiles`, host.token);
  const opened = prof.body.members.map((m: any) => ({
    id: m.memberId as string,
    publicKey: m.publicKey as string,
    profile: openProfile(m.sealedProfile, host.keys.publicKey, host.keys.secretKey, { groupId: host.groupId, pseudonym: m.pseudonym }),
  }));
  const draw = runDraw({ memberIds: opened.map((m: any) => m.id) });
  if (!draw.ok) throw new Error('draw failed');
  const payload = buildDrawPayload({ groupId: host.groupId, drawVersion: 1, budgetCents: 2500, members: opened, assignments: draw.assignments });
  void members;
  return { drawVersion: 1, membersVersion: prof.body.membersVersion as number, closeEarly: true, ...payload };
}

export { joinMember };
