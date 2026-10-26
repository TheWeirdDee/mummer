import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWorld, drawGroup, setupGroup, type World } from './harness.js';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

describe('POST /api/groups/:id/extend (change the dates before the draw)', () => {
  it('moves the deadline and reveal, recomputing every derived instant', async () => {
    const { c, host } = await setupGroup(w, 4, { timezone: 'America/New_York' });
    const r = await c.post(`/api/groups/${host.groupId}/extend`, { joinDeadline: '2026-12-05', revealDate: '2026-12-31' }, host.token);
    expect(r.status).toBe(200);
    const row = await w.db.prepare('SELECT * FROM groups WHERE id = ?1').bind(host.groupId).first<Record<string, string>>();
    expect(row).toMatchObject({
      join_deadline: '2026-12-05',
      reveal_date: '2026-12-31',
      join_closes_at: '2026-12-06T05:00:00.000Z',
      reveal_at: '2026-12-31T05:00:00.000Z',
      expires_at: '2027-01-30T05:00:00.000Z',
    });
  });

  it('reopens a group whose joining had closed (by deadline or by the host), so a small group can recruit more people', async () => {
    const { c, host } = await setupGroup(w, 3, { memberCap: 20 });
    w.clock.set('2026-11-21T00:00:00.000Z'); // after the 2026-11-20 deadline
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).body.group.state).toBe('locked');
    expect((await c.get(`/api/groups/${host.groupId}/invite`)).body.joinOpen).toBe(false);
    const r = await c.post(`/api/groups/${host.groupId}/extend`, { joinDeadline: '2026-11-28', revealDate: '2026-12-24' }, host.token);
    expect(r.body.state).toBe('open');
    expect((await c.get(`/api/groups/${host.groupId}/invite`)).body.joinOpen).toBe(true);
    // Locked by the host, then extended: open again too.
    await c.post(`/api/groups/${host.groupId}/transition`, { action: 'lock' }, host.token);
    expect((await c.post(`/api/groups/${host.groupId}/extend`, { joinDeadline: '2026-11-29', revealDate: '2026-12-24' }, host.token)).body.state).toBe('open');
  });

  it('is refused after the draw and for a closed exchange', async () => {
    const s = await setupGroup(w, 4);
    await drawGroup(w, s.c, s.host, s.members);
    const r = await s.c.post(`/api/groups/${s.host.groupId}/extend`, { joinDeadline: '2026-12-05', revealDate: '2026-12-31' }, s.host.token);
    expect(r.status).toBe(409);
    const t = await setupGroup(w, 4);
    await t.c.post(`/api/groups/${t.host.groupId}/transition`, { action: 'close' }, t.host.token);
    expect((await t.c.post(`/api/groups/${t.host.groupId}/extend`, { joinDeadline: '2026-12-05', revealDate: '2026-12-31' }, t.host.token)).status).toBe(409);
  });

  it.each([
    ['deadline in the past', { joinDeadline: '2026-10-01', revealDate: '2026-12-24' }],
    ['deadline too far away', { joinDeadline: '2027-06-01', revealDate: '2027-06-10' }],
    ['reveal not after the deadline', { joinDeadline: '2026-12-05', revealDate: '2026-12-05' }],
    ['reveal too far away', { joinDeadline: '2026-12-05', revealDate: '2027-09-01' }],
    ['invalid date', { joinDeadline: '2026-02-30', revealDate: '2026-12-24' }],
    ['unknown field', { joinDeadline: '2026-12-05', revealDate: '2026-12-24', title: 'hijack' }],
  ])('rejects: %s', async (_n, body) => {
    const { c, host } = await setupGroup(w, 4);
    const r = await c.post(`/api/groups/${host.groupId}/extend`, body, host.token);
    expect(r.status).toBe(422);
  });

  it('is host-only and leaves the other fields alone', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    const body = { joinDeadline: '2026-12-05', revealDate: '2026-12-31' };
    expect((await c.post(`/api/groups/${host.groupId}/extend`, body)).status).toBe(401);
    expect((await c.post(`/api/groups/${host.groupId}/extend`, body, members[0]!.token)).status).toBe(401);
    await c.post(`/api/groups/${host.groupId}/extend`, body, host.token);
    const row = await w.db.prepare('SELECT title, budget_cents, member_cap, timezone FROM groups WHERE id = ?1').bind(host.groupId).first();
    expect(row).toEqual({ title: 'Winter Santa', budget_cents: 2500, member_cap: 20, timezone: 'UTC' });
  });
});
