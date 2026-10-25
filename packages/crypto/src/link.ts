import { decodeKey, encodeKey } from './keys.js';
import { isToken } from './tokens.js';

/**
 * Private links carry secrets ONLY in the URL fragment, which browsers do not
 * send to servers or in Referer headers:
 *
 *   /g/<groupId>/admin#k=<secret key>&t=<token>
 *   /g/<groupId>/m/<memberId>#k=<secret key>&t=<token>
 *
 * `k` is the X25519 secret key (never leaves the browser); `t` is the bearer
 * token sent in an Authorization header. JavaScript on the page can read the
 * fragment, which is why the app serves no third-party scripts on these routes.
 */

export interface LinkSecrets {
  secretKey: Uint8Array;
  token: string;
}

export function buildFragment(secrets: LinkSecrets): string {
  if (!isToken(secrets.token)) throw new Error('Invalid token');
  return `#k=${encodeKey(secrets.secretKey)}&t=${secrets.token}`;
}

/** Strict parser: exactly one k and one t, valid lengths and alphabets, nothing else. Returns undefined on any deviation. */
export function parseFragment(hash: string): LinkSecrets | undefined {
  if (typeof hash !== 'string' || hash.length > 200) return undefined;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const parts = body.split('&');
  if (parts.length !== 2) return undefined;
  let k: string | undefined;
  let t: string | undefined;
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 1) return undefined;
    const name = p.slice(0, eq);
    const value = p.slice(eq + 1);
    if (name === 'k' && k === undefined) k = value;
    else if (name === 't' && t === undefined) t = value;
    else return undefined;
  }
  if (k === undefined || t === undefined || !isToken(t)) return undefined;
  try {
    return { secretKey: decodeKey(k), token: t };
  } catch {
    return undefined;
  }
}

export function adminPath(groupId: string): string {
  return `/g/${groupId}/admin`;
}

export function memberPath(groupId: string, memberId: string): string {
  return `/g/${groupId}/m/${memberId}`;
}

export function invitePath(groupId: string): string {
  return `/g/${groupId}`;
}
