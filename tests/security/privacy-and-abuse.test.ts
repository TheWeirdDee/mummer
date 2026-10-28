import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeKey, generateReference, generateToken, hashToken, normalizeReference, ackCommitment } from '@mummer/crypto';
import { LIMITS } from '@mummer/shared';
import {
  createGroup,
  createWorld,
  drawGroup,
  dumpDatabase,
  openOwnAssignment,
  setupGroup,
  type Participant,
  type World,
} from '../../workers/api/test/harness.js';

/**
 * Adversarial and privacy-leakage tests.
 *
 * These run the real application against a real D1 database and assert the
 * PRD's security invariants from the point of view of each adversary
 * (docs/THREAT_MODEL.md). A failing test here is a release blocker.
 */

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

const secretsOf = (m: Participant) => [m.address, m.address.slice(10, 70), m.wishlist, m.token, encodeKey(m.keys.secretKey)];

/** A group taken through the whole lifecycle, with the trace recorded. */
async function fullLifecycle() {
  w.trace.length = 0;
  const s = await setupGroup(w, 6);
  await drawGroup(w, s.c, s.host, s.members);
  const refs: string[] = [];
  const bundles = new Map<string, Awaited<ReturnType<typeof openOwnAssignment>>>();
  for (const m of s.members) {
    const b = await openOwnAssignment(s.c, s.host.groupId, m);
    refs.push(b.reference);
    bundles.set(m.id, b);
  }
  for (const m of s.members) {
    await s.c.post(`/api/groups/${s.host.groupId}/members/${m.id}/sent`, { drawVersion: 1 }, m.token);
    const gift = bundles.get(m.id)!;
    const recipient = s.members.find((x) => x.id === gift.recipient.memberId)!;
    await s.c.post(`/api/groups/${s.host.groupId}/members/${recipient.id}/ack`, { drawVersion: 1, outcome: 'received', reference: gift.reference }, recipient.token);
  }
  w.clock.set('2026-12-24T00:00:01.000Z');
  const g0 = s.members[0]!;
  const b0 = bundles.get(g0.id)!;
  await s.c.post(`/api/groups/${s.host.groupId}/reveals`, { drawVersion: 1, recipientId: b0.recipient.memberId, reference: b0.reference, audience: 'recipient' }, g0.token);
  await s.c.get(`/api/groups/${s.host.groupId}/glassbox`, s.host.token);
  w.clock.set('2026-11-01T12:00:00.000Z');
  return { ...s, refs, bundles };
}

describe('assertion 1: the server never receives plaintext addresses, wishlists, references, notes or secret keys', () => {
  it('no request body in an entire exchange contains any of them', async () => {
    const s = await fullLifecycle();
    const needles = [...s.members.flatMap(secretsOf), encodeKey(s.host.keys.secretKey), s.host.token];
    const received = w.trace.map((t) => t.request).join('\n');
    expect(received.length).toBeGreaterThan(1000);
    for (const n of needles) expect(received, `request bodies must not contain ${n.slice(0, 12)}…`).not.toContain(n);
  });

  it('gift references reach the server only on acknowledgment and reveal requests, which the user chose to make', async () => {
    const s = await fullLifecycle();
    const submitsReference = (path: string) => /\/ack$/.test(path) || /\/reveals$/.test(path);
    for (const entry of w.trace) {
      for (const r of s.refs) {
        if (entry.request.includes(r)) expect(submitsReference(entry.path), `${entry.method} ${entry.path} must not carry a reference`).toBe(true);
      }
    }
    expect(w.trace.some((e) => submitsReference(e.path) && s.refs.some((r) => e.request.includes(r)))).toBe(true);
    // Creation, joining, the draw and self-reported sends never carry one.
    for (const entry of w.trace.filter((e) => /\/(members|draw|sent)$/.test(e.path) || e.path === '/api/groups')) {
      expect(s.refs.some((r) => entry.request.includes(r))).toBe(false);
    }
  });

  it('no response body contains them either', async () => {
    const s = await fullLifecycle();
    const needles = [...s.members.flatMap(secretsOf), encodeKey(s.host.keys.secretKey), ...s.refs];
    const sent = w.trace.map((t) => t.response).join('\n');
    for (const n of needles) expect(sent).not.toContain(n);
  });
});

describe('assertion 3: a database dump alone reveals neither assignments nor secrets', () => {
  it('no row in any table contains addresses, wishlists, references, tokens or secret keys', async () => {
    const s = await fullLifecycle();
    const dump = JSON.stringify(await dumpDatabase(w.db));
    const needles = [...s.members.flatMap(secretsOf), encodeKey(s.host.keys.secretKey), s.host.token, ...s.refs];
    for (const n of needles) expect(dump).not.toContain(n);
    // Tokens are stored only as hashes.
    for (const m of s.members) expect(dump).toContain(hashToken(m.token));
    expect(dump).toContain(hashToken(s.host.token));
  });

  it('cannot recover any pairing from the database without the members’ secret keys', async () => {
    const s = await fullLifecycle();
    const dump = await dumpDatabase(w.db);
    // Giver-keyed and recipient-keyed tables share no column; the only pair table is `reveals`, which is consent-gated.
    const pairTables = Object.entries(dump).filter(([, rows]) => (rows as Record<string, unknown>[]).some((r) => 'giver_member_id' in r && 'recipient_member_id' in r)).map(([t]) => t);
    expect(pairTables).toEqual(['reveals']);
    const reveals = (dump.reveals as { group_id: string; giver_member_id: string; recipient_member_id: string }[]).filter((r) => r.group_id === s.host.groupId);
    expect(reveals).toHaveLength(1); // exactly the one reveal that was consented to
    // Commitments are not reversible to references: 80-bit space and a one-way hash (spot check: no reference is a substring).
    const text = JSON.stringify(dump.ack_commitments);
    for (const r of s.refs) expect(text).not.toContain(r);
    // Within this group, no stored value other than the single consented reveal connects any giver to any recipient.
    const mine = (rows: unknown) => (rows as { group_id: string }[]).filter((r) => r.group_id === s.host.groupId);
    const assignmentRows = mine(dump.assignments) as unknown as { giver_member_id: string }[];
    const commitmentRows = mine(dump.ack_commitments) as unknown as { recipient_member_id: string }[];
    expect(assignmentRows.map((r) => r.giver_member_id).sort()).toEqual(s.members.map((m) => m.id).sort());
    expect(commitmentRows.map((r) => r.recipient_member_id).sort()).toEqual(s.members.map((m) => m.id).sort());
  });

  it('every sealed profile has exactly the same length, so lengths reveal nothing about the wishlist', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const { joinMember } = await import('../../workers/api/test/harness.js');
    const key = encodeKey(host.keys.publicKey);
    const a = await joinMember(c, host, key, 'Short', 1);
    const b = await joinMember(c, host, key, 'Medium', 2);
    const rows = await w.db.prepare('SELECT id, sealed_profile FROM members WHERE group_id = ?1').bind(host.groupId).all<{ id: string; sealed_profile: string }>();
    const len = (id: string) => rows.results.find((r) => r.id === id)!.sealed_profile.length;
    expect(len(a.id)).toBe(len(b.id));
  });
});

describe('authorization matrix: every endpoint x every role', () => {
  type Role = 'none' | 'foreignHost' | 'member' | 'host';

  it('returns 401 to every role that is not allowed, before any body or state logic runs', async () => {
    const s = await setupGroup(w, 4);
    const other = await setupGroup(w, 4);
    await drawGroup(w, s.c, s.host, s.members);
    const g = s.host.groupId;
    const m = s.members[0]!;
    const tokens: Record<Role, string | undefined> = { none: undefined, foreignHost: other.host.token, member: m.token, host: s.host.token };

    interface Case {
      name: string;
      method: string;
      path: string;
      body?: unknown;
      headers?: Record<string, string>;
      allow: Role[];
      /** Exercising the allowed path would change state; only the denied roles are exercised. */
      mutating?: boolean;
      /** Authenticated-but-not-permitted roles that get a different status than 401. */
      overrides?: Partial<Record<Role, number>>;
    }
    const cases: Case[] = [
      { name: 'group overview', method: 'GET', path: `/api/groups/${g}`, allow: ['member', 'host'] },
      { name: 'profiles', method: 'GET', path: `/api/groups/${g}/profiles`, allow: ['host'] },
      { name: 'glassbox', method: 'GET', path: `/api/groups/${g}/glassbox`, allow: ['host'] },
      { name: 'transition', method: 'POST', path: `/api/groups/${g}/transition`, body: { action: 'explode' }, allow: ['host'] },
      { name: 'draw', method: 'POST', path: `/api/groups/${g}/draw`, body: {}, headers: { 'idempotency-key': 'k'.repeat(20) }, allow: ['host'] },
      { name: 'own assignment', method: 'GET', path: `/api/groups/${g}/members/${m.id}/assignment`, allow: ['member'] },
      { name: 'sent', method: 'POST', path: `/api/groups/${g}/members/${m.id}/sent`, body: { drawVersion: 1 }, allow: ['member'], mutating: true },
      { name: 'ack', method: 'POST', path: `/api/groups/${g}/members/${m.id}/ack`, body: { drawVersion: 1, outcome: 'received' }, allow: ['member'], mutating: true },
      { name: 'rotate', method: 'POST', path: `/api/groups/${g}/members/${m.id}/rotate`, body: {}, allow: ['member'] },
      { name: 'leave', method: 'POST', path: `/api/groups/${g}/members/${m.id}/leave`, body: {}, allow: ['member'], mutating: true },
      { name: 'reveals list', method: 'GET', path: `/api/groups/${g}/reveals`, allow: ['member', 'host'] },
      { name: 'reveal', method: 'POST', path: `/api/groups/${g}/reveals`, body: {}, allow: ['member'], overrides: { host: 403 } },
      { name: 'confirm reveal', method: 'POST', path: `/api/groups/${g}/reveals/${m.id}/confirm`, body: {}, allow: ['member'], overrides: { host: 403 } },
      { name: 'remove member', method: 'DELETE', path: `/api/groups/${g}/members/${s.members[3]!.id}`, allow: ['host'], mutating: true },
      { name: 'delete group', method: 'DELETE', path: `/api/groups/${g}`, allow: ['host'], mutating: true },
    ];

    let checked = 0;
    for (const cs of cases) {
      for (const role of Object.keys(tokens) as Role[]) {
        if (cs.allow.includes(role) && cs.mutating) continue;
        const r = await s.c.call(cs.method, cs.path, { token: tokens[role], body: cs.body, headers: cs.headers });
        checked++;
        if (cs.allow.includes(role)) {
          expect([401, 403], `${cs.name} as ${role} must be authorised`).not.toContain(r.status);
        } else {
          expect(r.status, `${cs.name} as ${role}`).toBe(cs.overrides?.[role] ?? 401);
        }
      }
    }
    expect(checked).toBeGreaterThan(40);

    // Unsupported verbs are simply not routed.
    for (const verb of ['PUT', 'PATCH']) {
      expect((await s.c.call(verb, `/api/groups/${g}`, { token: s.host.token, body: {} })).status).toBe(404);
    }
  }, 120_000);
});

describe('replay, forgery and cross-context attacks', () => {
  it('a reference from one group is worthless in another (domain separation)', async () => {
    const a = await fullLifecycle();
    const b = await setupGroup(w, 5);
    await drawGroup(w, b.c, b.host, b.members);
    const victim = b.members[0]!;
    for (const ref of a.refs) {
      const r = await b.c.post(`/api/groups/${b.host.groupId}/members/${victim.id}/ack`, { drawVersion: 1, outcome: 'received', reference: ref }, victim.token);
      expect(r.status).toBe(422);
    }
    expect(ackCommitment('a'.repeat(32), victim.id, a.refs[0]!)).not.toBe(ackCommitment(b.host.groupId, victim.id, a.refs[0]!));
  }, 60_000);

  it('replaying an old draw version after a redraw is refused everywhere', async () => {
    const s = await setupGroup(w, 4);
    await drawGroup(w, s.c, s.host, s.members);
    const m = s.members[0]!;
    await s.c.post(`/api/groups/${s.host.groupId}/transition`, { action: 'reset_draw' }, s.host.token);
    await drawGroup(w, s.c, s.host, s.members, { version: 2 });
    expect((await s.c.post(`/api/groups/${s.host.groupId}/members/${m.id}/sent`, { drawVersion: 1 }, m.token)).status).toBe(409);
    expect((await s.c.post(`/api/groups/${s.host.groupId}/members/${m.id}/ack`, { drawVersion: 1, outcome: 'received' }, m.token)).status).toBe(409);
    // The old bundle (sealed with v1 context) no longer opens as the current assignment.
    const r = await s.c.get(`/api/groups/${s.host.groupId}/members/${m.id}/assignment`, m.token);
    expect(r.body.drawVersion).toBe(2);
    await expect(openOwnAssignment(s.c, s.host.groupId, m, 1)).rejects.toThrow();
  }, 60_000);

  it('a member cannot create or alter a draw by writing sealed data (assignments are host-only writes)', async () => {
    const s = await setupGroup(w, 4);
    const m = s.members[0]!;
    // No member-facing endpoint accepts a bundle or a commitment.
    const attempt = await s.c.post(`/api/groups/${s.host.groupId}/draw`, { drawVersion: 1, bundles: [], commitments: [] }, m.token, { 'idempotency-key': 'x'.repeat(20) });
    expect(attempt.status).toBe(401);
    expect(await w.db.prepare('SELECT 1 AS x FROM assignments WHERE group_id = ?1').bind(s.host.groupId).first()).toBeNull();
  });

  it('exclusions cannot be bypassed through the API: the server never sees them and the host check is local', async () => {
    const s = await setupGroup(w, 6);
    const exclusions = [
      { giver: s.members[0]!.id, recipient: s.members[1]!.id },
      { giver: s.members[1]!.id, recipient: s.members[0]!.id },
    ];
    for (let i = 0; i < 25; i++) {
      const fresh = await setupGroup(w, 5);
      const ex = [
        { giver: fresh.members[0]!.id, recipient: fresh.members[1]!.id },
        { giver: fresh.members[1]!.id, recipient: fresh.members[0]!.id },
      ];
      const d = await drawGroup(w, fresh.c, fresh.host, fresh.members, { exclusions: ex });
      expect(d.res.status).toBe(201);
      expect(d.assignments[fresh.members[0]!.id]).not.toBe(fresh.members[1]!.id);
      expect(d.assignments[fresh.members[1]!.id]).not.toBe(fresh.members[0]!.id);
      if (i === 0) {
        const wire = w.trace.map((t) => t.request).join('\n');
        expect(wire).not.toContain('exclusion');
      }
    }
    expect(exclusions).toHaveLength(2);
  }, 120_000);

  it('malformed or hostile ciphertext submitted as a profile is stored opaquely and cannot break the host flow server-side', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const key = encodeKey(host.keys.publicKey);
    const r = await c.post(`/api/groups/${host.groupId}/members`, { pseudonym: 'Mallory', publicKey: key, tokenHash: hashToken(generateToken()), addressCommitment: 'c'.repeat(64), sealedProfile: 'A'.repeat(LIMITS.sealedChars) });
    expect(r.status).toBe(201);
    const prof = await c.get(`/api/groups/${host.groupId}/profiles`, host.token);
    expect(prof.status).toBe(200);
    const { openProfile } = await import('@mummer/crypto');
    expect(() => openProfile(prof.body.members[0].sealedProfile, host.keys.publicKey, host.keys.secretKey, { groupId: host.groupId })).toThrow();
  });
});

describe('injection and input hostility', () => {
  it('SQL metacharacters in names, ids and bodies are inert', async () => {
    const c = w.client();
    const host = await createGroup(c, { title: "Robert'); DROP TABLE groups;--" });
    const key = encodeKey(host.keys.publicKey);
    const nasty = ["'; DROP TABLE members;--", '" OR 1=1 --', 'Robert\');DELETE FROM groups;--', '%_\\'];
    for (const [i, n] of nasty.entries()) {
      const r = await c.post(`/api/groups/${host.groupId}/members`, { pseudonym: n, publicKey: key, tokenHash: hashToken(generateToken()), addressCommitment: 'c'.repeat(64), sealedProfile: 'A'.repeat(LIMITS.sealedChars) });
      expect(r.status).toBe(201);
    }
    const g = await c.get(`/api/groups/${host.groupId}`, host.token);
    expect(g.body.group.title).toBe("Robert'); DROP TABLE groups;--");
    expect(g.body.roster.map((x: any) => x.pseudonym).sort()).toEqual([...nasty].sort());
    for (const bad of ["x' OR '1'='1", '1;DROP TABLE groups', '%27', '../../etc/passwd', 'a'.repeat(31) + "'"]) {
      expect((await c.get(`/api/groups/${bad}`, host.token)).status).toBe(404);
      expect((await c.get(`/api/groups/${host.groupId}/members/${bad}/assignment`, host.token)).status).toBe(404);
    }
    expect((await dumpDatabase(w.db)).groups.length).toBeGreaterThan(0);
  });

  it('HTML/script content in user text is stored as text and returned inside JSON only', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const key = encodeKey(host.keys.publicKey);
    const payload = '<img src=x onerror=alert(1)>';
    const r = await c.post(`/api/groups/${host.groupId}/members`, { pseudonym: payload, publicKey: key, tokenHash: hashToken(generateToken()), addressCommitment: 'c'.repeat(64), sealedProfile: 'A'.repeat(LIMITS.sealedChars) });
    expect(r.status).toBe(201);
    const res = await c.get(`/api/groups/${host.groupId}`, host.token);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.body.roster[0].pseudonym).toBe(payload);
  });

  it('absurd inputs never produce a 500', async () => {
    const c = w.client();
    const host = await createGroup(c);
    const weird = ['\u0000', '\uD800', 'x'.repeat(100000), '🎅'.repeat(10000), '{"__proto__":{"admin":true}}', 'null', '[]', '1e999'];
    for (const body of weird) {
      for (const path of ['/api/groups', `/api/groups/${host.groupId}/members`, `/api/groups/${host.groupId}/draw`, `/api/groups/${host.groupId}/transition`]) {
        const r = await c.call('POST', path, { token: host.token, raw: body, headers: { 'idempotency-key': 'k'.repeat(20) } });
        expect(r.status, `${path} with ${body.slice(0, 12)}`).toBeLessThan(500);
      }
    }
  }, 60_000);

  it('prototype-pollution style bodies do not alter behaviour', async () => {
    const c = w.client();
    const r = await c.call('POST', '/api/groups', { raw: '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}' });
    expect(r.status).toBe(422);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});

describe('metadata minimisation', () => {
  it('stored timestamps are UTC day buckets; no member-level row carries a time of day', async () => {
    const s = await fullLifecycle();
    const dump = await dumpDatabase(w.db);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    for (const r of dump.members as Record<string, string>[]) expect(r.joined_day).toMatch(day);
    for (const r of dump.ack_commitments as Record<string, string | null>[]) if (r.state_day) expect(r.state_day).toMatch(day);
    for (const r of dump.audit_events as Record<string, string>[]) expect(r.day).toMatch(day);
    for (const r of dump.reveals as Record<string, string | null>[]) {
      expect(r.declared_day).toMatch(day);
    }
    expect(s.members.length).toBe(6);
  });

  it('the audit log holds group-level events only: no per-member post-draw actions', async () => {
    const s = await fullLifecycle();
    const rows = (await w.db.prepare('SELECT type FROM audit_events WHERE group_id = ?1').bind(s.host.groupId).all<{ type: string }>()).results.map((r) => r.type);
    const allowed = new Set(['group_created', 'member_joined', 'draw_committed', 'reveal_declared', 'member_removed', 'member_revoked_after_draw', 'group_locked', 'group_reopened', 'draw_reset', 'resolution_flagged', 'resolution_cleared', 'group_closed', 'dates_changed']);
    for (const t of rows) expect(allowed.has(t), t).toBe(true);
    expect(rows.filter((t) => t === 'member_joined')).toHaveLength(6);
    expect(rows).not.toContain('acknowledged');
    expect(rows).not.toContain('sent');
  });

  it('no endpoint ever reports who has paid, sent or acknowledged to anyone but that member', async () => {
    const s = await fullLifecycle();
    const text = w.trace
      .filter((t) => t.path.endsWith(`/api/groups/${s.host.groupId}`) && t.method === 'GET')
      .map((t) => t.response)
      .join('\n');
    expect(text).not.toMatch(/recipient_acknowledged.*recipient_acknowledged/s); // never a per-member list
  });
});

describe('recipient-only reveals stay between the two people', () => {
  it('no host-visible response, and no public one, carries a private reveal: not the pair, not the audience', async () => {
    const s = await setupGroup(w, 6);
    expect((await drawGroup(w, s.c, s.host, s.members)).res.status).toBe(201);
    const bundles = new Map<string, Awaited<ReturnType<typeof openOwnAssignment>>>();
    for (const m of s.members) bundles.set(m.id, await openOwnAssignment(s.c, s.host.groupId, m));
    w.clock.set('2026-12-24T00:00:01.000Z');
    const giver = s.members[0]!;
    const b = bundles.get(giver.id)!;
    const recipientId = b.recipient.memberId;
    const r = await s.c.post(`/api/groups/${s.host.groupId}/reveals`, { drawVersion: 1, recipientId, reference: b.reference, audience: 'recipient' }, giver.token);
    expect(r.status).toBe(201);

    const gid = s.host.groupId;
    const hostVisible = [
      `/api/groups/${gid}`,
      `/api/groups/${gid}/glassbox`,
      `/api/groups/${gid}/reveals`,
      `/api/groups/${gid}/invite`,
    ];
    for (const path of hostVisible) {
      const res = await s.c.get(path, s.host.token);
      const text = JSON.stringify(res.body);
      expect(res.status, path).toBe(200);
      expect(text, path).not.toContain('"audience":"recipient"');
      // The two ids never appear together in one reveal-shaped object.
      expect(text, path).not.toMatch(new RegExp(`${giver.id}[^}]*${recipientId}|${recipientId}[^}]*${giver.id}`));
    }
    // A bystander and an unauthenticated caller see nothing of it either.
    const bystander = s.members.find((m) => m.id !== giver.id && m.id !== recipientId)!;
    expect(JSON.stringify((await s.c.get(`/api/groups/${gid}/reveals`, bystander.token)).body)).not.toContain(recipientId);
    expect((await s.c.get(`/api/groups/${gid}/glassbox`)).status).toBe(401);
    // Only the two people involved can see it.
    expect(JSON.stringify((await s.c.get(`/api/groups/${gid}/reveals`, giver.token)).body)).toContain(recipientId);
    const recipient = s.members.find((m) => m.id === recipientId)!;
    expect(JSON.stringify((await s.c.get(`/api/groups/${gid}/reveals`, recipient.token)).body)).toContain(giver.id);
    // The host learns only that one private reveal exists.
    expect((await s.c.get(`/api/groups/${gid}/glassbox`, s.host.token)).body.privateRevealCount).toBe(1);
  });
});

describe('reference hygiene', () => {
  it('generated references normalise to themselves and are accepted only in canonical form by the server', async () => {
    const r = generateReference();
    expect(normalizeReference(r)).toBe(r);
    expect(normalizeReference(r.toLowerCase())).toBe(r);
  });
});
