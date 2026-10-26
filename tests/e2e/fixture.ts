import { runDraw } from '@mummer/draw';
import {
  addressCommitment,
  buildDrawPayload,
  buildFragment,
  encodeKey,
  generateKeyPair,
  generateToken,
  hashToken,
  openProfile,
  ready,
  sealProfile,
  type KeyPair,
} from '@mummer/crypto';
import { shieldedAddresses } from './helpers';

/**
 * Builds exchanges directly against the running server's HTTP API with real
 * cryptography, so layout / accessibility / security suites can open any state
 * (waiting room, drawn, payment, reveal) without clicking through the whole UI.
 * The UI journey itself is covered end to end in exchange.spec.ts.
 */

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? '8788'}`;
let ip = 100;

async function call<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `203.0.113.${(ip++ % 250) + 1}`,
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

export interface FixtureMember {
  name: string;
  id: string;
  keys: KeyPair;
  token: string;
  /** Full private link including the secret fragment. */
  link: string;
  address: string;
  wishlist: string;
}

export interface Fixture {
  gid: string;
  title: string;
  invite: string;
  hostPublicKey: string;
  adminLink: string;
  host: { keys: KeyPair; token: string };
  members: FixtureMember[];
}

const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia'];

export async function makeExchange(opts: { title?: string; members?: number; draw?: boolean; patch?: Record<string, unknown> } = {}): Promise<Fixture> {
  await ready();
  const n = opts.members ?? 5;
  const title = opts.title ?? `Fixture ${Math.random().toString(36).slice(2, 7)}`;
  const hostKeys = await generateKeyPair();
  const hostToken = generateToken();
  const today = new Date();
  const iso = (d: number) => new Date(today.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  const created = await call('POST', '/api/groups', {
    body: {
      title,
      budgetCents: 2500,
      joinDeadline: iso(10),
      revealDate: iso(17),
      timezone: 'UTC',
      memberCap: 20,
      hostPlays: false,
      hostPublicKey: encodeKey(hostKeys.publicKey),
      adminTokenHash: hashToken(hostToken),
      ...(opts.patch ?? {}),
    },
  });
  if (created.status !== 201) throw new Error(`create failed ${created.status} ${JSON.stringify(created.body)}`);
  const gid: string = created.body.groupId;
  const addresses = shieldedAddresses(Math.max(n, 5));
  const members: FixtureMember[] = [];
  for (let i = 0; i < n; i++) {
    const keys = await generateKeyPair();
    const token = generateToken();
    const name = NAMES[i % NAMES.length]! + (i >= NAMES.length ? ` ${i}` : '');
    const wishlist = `${name} would love socks and a good book`;
    const sealedProfile = sealProfile({ v: 1, kind: 'profile', groupId: gid, pseudonym: name, wishlist, address: addresses[i % addresses.length]! }, encodeKey(hostKeys.publicKey));
    const r = await call('POST', `/api/groups/${gid}/members`, { body: { pseudonym: name, publicKey: encodeKey(keys.publicKey), tokenHash: hashToken(token), sealedProfile, addressCommitment: addressCommitment(gid, name, addresses[i % addresses.length]!) } });
    if (r.status !== 201) throw new Error(`join failed ${r.status} ${JSON.stringify(r.body)}`);
    members.push({ name, id: r.body.memberId, keys, token, address: addresses[i % addresses.length]!, wishlist, link: `${BASE}/g/${gid}/m/${r.body.memberId}${buildFragment({ secretKey: keys.secretKey, token })}` });
  }
  if (opts.draw) {
    const prof = await call('GET', `/api/groups/${gid}/profiles`, { token: hostToken });
    const opened = prof.body.members.map((m: any) => ({ id: m.memberId, publicKey: m.publicKey, profile: openProfile(m.sealedProfile, hostKeys.publicKey, hostKeys.secretKey, { groupId: gid, pseudonym: m.pseudonym }) }));
    const d = runDraw({ memberIds: opened.map((m: any) => m.id) });
    if (!d.ok) throw new Error('draw failed');
    const payload = buildDrawPayload({ groupId: gid, drawVersion: 1, budgetCents: 2500, members: opened, assignments: d.assignments });
    const r = await call('POST', `/api/groups/${gid}/draw`, { token: hostToken, body: { drawVersion: 1, membersVersion: prof.body.membersVersion, closeEarly: true, ...payload }, headers: { 'idempotency-key': generateToken().slice(0, 32) } });
    if (r.status !== 201) throw new Error(`draw post failed ${r.status} ${JSON.stringify(r.body)}`);
  }
  return {
    gid,
    title,
    invite: `${BASE}/g/${gid}`,
    hostPublicKey: encodeKey(hostKeys.publicKey),
    adminLink: `${BASE}/g/${gid}/admin${buildFragment({ secretKey: hostKeys.secretKey, token: hostToken })}`,
    host: { keys: hostKeys, token: hostToken },
    members,
  };
}

export async function api<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return call<T>(method, path, opts);
}
