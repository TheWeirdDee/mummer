import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { runDraw } from '@mummer/draw';
import {
  buildDrawPayload,
  encodeKey,
  generateId,
  generateKeyPair,
  generateToken,
  hashToken,
  openAssignment,
  openProfile,
  publicKeyFromSecret,
  ready,
  sealProfile,
  type KeyPair,
} from '@mummer/crypto';
import { createApp } from '../src/app.js';
import type { Deps, Env } from '../src/env.js';

/**
 * Integration harness: the real Hono app + real D1 (workerd via Miniflare),
 * real sealed-box cryptography, and a controllable clock. Nothing is mocked
 * except the clock, the price feed and the Turnstile verifier.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', 'migrations');

export const NOW = new Date('2026-11-01T12:00:00.000Z');
export const ADDRESS_A = 'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf';

export class Clock {
  constructor(public current: Date = new Date(NOW)) {}
  set(iso: string) {
    this.current = new Date(iso);
  }
  advanceMs(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
  now = () => new Date(this.current);
}

export interface World {
  mf: Miniflare;
  env: Env;
  clock: Clock;
  app: ReturnType<typeof createApp>;
  deps: Deps;
  priceFails: { value: boolean };
  dispose(): Promise<void>;
  client(ip?: string): Client;
  db: D1Database;
  /** Every request body the server received and every response body it sent, for leakage inspection. */
  trace: { method: string; path: string; request: string; response: string; status: number }[];
}

function statements(sql: string): string[] {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

let ipCounter = 0;

export async function createWorld(overrides: Partial<Env> = {}, depsOverrides: Partial<Deps> = {}): Promise<World> {
  await ready();
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: { DB: `db-${Math.random().toString(36).slice(2)}` } });
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    for (const s of statements(readFileSync(join(MIGRATIONS, file), 'utf8'))) await db.prepare(s).run();
  }
  const clock = new Clock();
  const priceFails = { value: false };
  const deps: Deps = {
    now: clock.now,
    verifyHuman: async (token) => token === 'turnstile-ok',
    fetchPrice: async () => {
      if (priceFails.value) throw Object.assign(new Error('down'), { status: 503 });
      return { usdPerZec: '31.54000000', asOf: clock.now().toISOString(), source: 'test' };
    },
    ...depsOverrides,
  };
  const env: Env = { DB: db, ENVIRONMENT: 'test', RATE_LIMIT_SALT: 'test-salt', BUILD_COMMIT: 'test-commit', ...overrides };
  const app = createApp(deps);
  const world: World = {
    mf,
    env,
    clock,
    app,
    deps,
    priceFails,
    db,
    trace: [],
    dispose: () => mf.dispose(),
    client: (ip) => new Client(world, ip ?? `203.0.113.${(++ipCounter % 250) + 1}`),
  };
  return world;
}

export interface Reply<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export class Client {
  constructor(
    private w: World,
    readonly ip: string,
  ) {}

  async call<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}): Promise<Reply<T>> {
    const headers: Record<string, string> = { 'cf-connecting-ip': this.ip, ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let body: string | undefined;
    if (opts.raw !== undefined) body = opts.raw;
    else if (opts.body !== undefined) body = JSON.stringify(opts.body);
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.w.app.fetch(new Request(`https://mummer.test${path}`, { method, headers, body }), this.w.env);
    const text = await res.text();
    this.w.trace.push({ method, path, request: body ?? '', response: text, status: res.status });
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }
  get = <T = any>(path: string, token?: string) => this.call<T>('GET', path, { token });
  post = <T = any>(path: string, body: unknown, token?: string, headers?: Record<string, string>) => this.call<T>('POST', path, { token, body, headers });
  del = <T = any>(path: string, token?: string) => this.call<T>('DELETE', path, { token });
}

/* ---------- Scenario helpers using real cryptography ---------- */

export interface Host {
  groupId: string;
  keys: KeyPair;
  token: string;
}

export interface Participant {
  name: string;
  id: string;
  keys: KeyPair;
  token: string;
  address: string;
  wishlist: string;
}

export const groupConfig = (hostPublicKey: string, adminTokenHash: string, patch: Record<string, unknown> = {}) => ({
  title: 'Winter Santa',
  budgetCents: 2500,
  joinDeadline: '2026-11-20',
  revealDate: '2026-12-24',
  timezone: 'UTC',
  memberCap: 20,
  hostPlays: false,
  hostPublicKey,
  adminTokenHash,
  ...patch,
});

export async function createGroup(c: Client, patch: Record<string, unknown> = {}): Promise<Host> {
  const keys = await generateKeyPair();
  const token = generateToken();
  const r = await c.post('/api/groups', groupConfig(encodeKey(keys.publicKey), hashToken(token), patch));
  if (r.status !== 201) throw new Error(`createGroup failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { groupId: r.body.groupId, keys, token };
}

/** Distinct, realistic-looking (but obviously test) addresses: real UA vector with a per-member suffix is not needed for sealing. */
export function testAddress(i: number): string {
  return `${ADDRESS_A.slice(0, 120)}${i.toString().padStart(3, 'x')}`;
}

export async function joinMember(c: Client, host: Host, hostKeyB64: string, name: string, i: number, extra: Record<string, unknown> = {}): Promise<Participant> {
  const keys = await generateKeyPair();
  const token = generateToken();
  const address = testAddress(i);
  const wishlist = `${name} wants socks #${i}`;
  const sealedProfile = sealProfile({ v: 1, kind: 'profile', groupId: host.groupId, pseudonym: name, wishlist, address }, hostKeyB64);
  const r = await c.post(`/api/groups/${host.groupId}/members`, { pseudonym: name, publicKey: encodeKey(keys.publicKey), tokenHash: hashToken(token), sealedProfile, ...extra });
  if (r.status !== 201 && r.status !== 200) throw new Error(`join failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { name, id: r.body.memberId, keys, token, address, wishlist };
}

export const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Hedy', 'Alan'];

export async function setupGroup(w: World, n: number, patch: Record<string, unknown> = {}) {
  const c = w.client();
  const host = await createGroup(c, patch);
  const hostKeyB64 = encodeKey(host.keys.publicKey);
  const members: Participant[] = [];
  for (let i = 0; i < n; i++) members.push(await joinMember(c, host, hostKeyB64, NAMES[i]!, i));
  return { c, host, members, hostKeyB64 };
}

/** Run the host's side of the draw exactly as the browser does, then POST it. */
export async function drawGroup(
  w: World,
  c: Client,
  host: Host,
  members: Participant[],
  opts: { key?: string; version?: number; closeEarly?: boolean; exclusions?: { giver: string; recipient: string }[] } = {},
) {
  const prof = await c.get(`/api/groups/${host.groupId}/profiles`, host.token);
  if (prof.status !== 200) throw new Error(`profiles failed: ${prof.status} ${JSON.stringify(prof.body)}`);
  const opened = prof.body.members.map((m: any) => ({
    id: m.memberId as string,
    publicKey: m.publicKey as string,
    profile: openProfile(m.sealedProfile, host.keys.publicKey, host.keys.secretKey, { groupId: host.groupId, pseudonym: m.pseudonym }),
  }));
  const ids = opened.map((m: any) => m.id);
  const draw = runDraw({ memberIds: ids, exclusions: opts.exclusions });
  if (!draw.ok) throw new Error(`draw failed: ${draw.reason}`);
  const group = await c.get(`/api/groups/${host.groupId}`, host.token);
  const version = opts.version ?? group.body.group.drawVersion + 1;
  const payload = buildDrawPayload({ groupId: host.groupId, drawVersion: version, budgetCents: 2500, members: opened, assignments: draw.assignments });
  const key = opts.key ?? generateToken().slice(0, 32);
  const res = await c.post(`/api/groups/${host.groupId}/draw`, { drawVersion: version, closeEarly: opts.closeEarly ?? true, ...payload }, host.token, { 'idempotency-key': key });
  return { res, assignments: draw.assignments, payload, key, version };
}

export async function openOwnAssignment(c: Client, groupId: string, m: Participant, version = 1) {
  const r = await c.get(`/api/groups/${groupId}/members/${m.id}/assignment`, m.token);
  if (r.status !== 200) throw new Error(`assignment fetch failed ${r.status}`);
  return openAssignment(r.body.sealedBundle, m.keys.publicKey, m.keys.secretKey, { groupId, memberId: m.id, drawVersion: version });
}

export { generateId, publicKeyFromSecret };

/** Every row in every application table, for leakage inspection. */
export async function dumpDatabase(db: D1Database): Promise<Record<string, unknown[]>> {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>();
  const out: Record<string, unknown[]> = {};
  for (const t of tables.results) out[t.name] = (await db.prepare(`SELECT * FROM ${t.name}`).all()).results;
  return out;
}
