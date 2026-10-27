import type { ApiErrorCode, GroupView, InviteView, RevealView } from '@mummer/shared';

/**
 * Typed client for the Mummer API. Secrets never go in URLs: bearer tokens are
 * sent in the Authorization header, and sealed payloads travel in JSON bodies.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Options {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Plain-language messages for errors whose server text is machine-oriented. Server text is kept where it is already readable. */
function friendlyMessage(status: number, code: string | undefined, message: string | undefined): string {
  if (code === 'unauthorized') return 'This link no longer works. Use your newest link or a backup.';
  if (code === 'rate_limited') return 'Too many tries. Please wait a little while and try again.';
  if (code === 'internal') return 'Something went wrong on our side. Please try again.';
  if (!message) return status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Something went wrong. Please try again.';
  // Validation messages arrive as "fieldName: message"; people don't need the field name.
  return message.replace(/^[A-Za-z][A-Za-z0-9.]*: /, '');
}

async function request<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, signal: opts.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', "We couldn't reach Mummer. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: ApiErrorCode; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', friendlyMessage(res.status, err?.code, err?.message));
  }
  return data as T;
}

export interface PublicConfig {
  humanCheckRequired: boolean;
  turnstileSiteKey: string | null;
  /** Origin of the separate human-check host. Null means no check can be shown. */
  humanCheckOrigin: string | null;
  environment: string;
  commit: string;
}
export interface PriceQuote {
  usdPerZec: string;
  asOf: string;
  validUntil: string;
  source: string;
}
export type StatsResponse =
  | { available: false; reason: string }
  | { available: true; roundedDownTo: number; groups: number; members: number; giftsAcknowledged: number };

export interface ProfileEntry {
  memberId: string;
  pseudonym: string;
  publicKey: string;
  sealedProfile: string;
  addressCommitment: string;
}
export interface AckResult {
  recipientState: 'recipient_acknowledged' | 'disputed' | 'not_acknowledged';
  referenceMatched: boolean;
}

export const api = {
  config: () => request<PublicConfig>('GET', '/api/config'),
  health: () => request<{ ok: boolean; environment: string; commit: string; time: string }>('GET', '/api/health'),
  stats: () => request<StatsResponse>('GET', '/api/stats'),
  price: (signal?: AbortSignal) => request<PriceQuote>('GET', '/api/price', { signal }),
  humanVerify: (token: string) => request<{ required: boolean; ticket: string | null; expiresInSeconds: number }>('POST', '/api/human/verify', { body: { token } }),

  createGroup: (body: unknown) => request<{ groupId: string }>('POST', '/api/groups', { body }),
  invite: (gid: string) => request<InviteView>('GET', `/api/groups/${gid}/invite`),
  join: (gid: string, body: unknown) => request<{ memberId: string }>('POST', `/api/groups/${gid}/members`, { body }),
  group: (gid: string, token: string, signal?: AbortSignal) => request<GroupView>('GET', `/api/groups/${gid}`, { token, signal }),
  profiles: (gid: string, token: string) => request<{ membersVersion: number; members: ProfileEntry[] }>('GET', `/api/groups/${gid}/profiles`, { token }),
  removeMember: (gid: string, mid: string, token: string) => request<{ removed: boolean; exception: boolean }>('DELETE', `/api/groups/${gid}/members/${mid}`, { token }),
  draw: (gid: string, token: string, idempotencyKey: string, body: unknown) =>
    request<{ drawVersion: number; replay: boolean }>('POST', `/api/groups/${gid}/draw`, { token, body, headers: { 'idempotency-key': idempotencyKey } }),
  extend: (gid: string, token: string, body: { joinDeadline: string; revealDate: string }) => request<{ joinDeadline: string; revealDate: string; state: string }>('POST', `/api/groups/${gid}/extend`, { token, body }),
  transition: (gid: string, token: string, action: string) => request<{ state: string }>('POST', `/api/groups/${gid}/transition`, { token, body: { action } }),
  deleteGroup: (gid: string, token: string) => request<{ deleted: boolean }>('DELETE', `/api/groups/${gid}`, { token }),
  glassbox: (gid: string, token: string) => request<Record<string, unknown>>('GET', `/api/groups/${gid}/glassbox`, { token }),

  assignment: (gid: string, mid: string, token: string) => request<{ drawVersion: number; sealedBundle: string }>('GET', `/api/groups/${gid}/members/${mid}/assignment`, { token }),
  sent: (gid: string, mid: string, token: string, drawVersion: number) => request<{ senderState: string }>('POST', `/api/groups/${gid}/members/${mid}/sent`, { token, body: { drawVersion } }),
  ack: (gid: string, mid: string, token: string, body: unknown) => request<AckResult>('POST', `/api/groups/${gid}/members/${mid}/ack`, { token, body }),
  rotate: (gid: string, mid: string, token: string, body: unknown) => request<{ rotated: boolean }>('POST', `/api/groups/${gid}/members/${mid}/rotate`, { token, body }),
  leave: (gid: string, mid: string, token: string) => request<{ left: boolean; exception: boolean }>('POST', `/api/groups/${gid}/members/${mid}/leave`, { token, body: {} }),
  reveal: (gid: string, token: string, body: unknown) => request<{ revealed: boolean; replay: boolean }>('POST', `/api/groups/${gid}/reveals`, { token, body }),
  confirmReveal: (gid: string, giverId: string, token: string) => request<{ confirmed: boolean }>('POST', `/api/groups/${gid}/reveals/${giverId}/confirm`, { token, body: {} }),
  reveals: (gid: string, token: string) => request<{ reveals: RevealView[] }>('GET', `/api/groups/${gid}/reveals`, { token }),
};
