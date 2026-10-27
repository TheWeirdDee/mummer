/**
 * Credential storage in this browser.
 *
 * A private link (#k=<secret key>&t=<token>) is the only account Mummer has.
 * To let a person return without re-pasting the link, credentials are kept in
 * localStorage on this device, and the fragment is removed from the address
 * bar once saved. They are never sent anywhere except the token, in an
 * Authorization header, to Mummer's own API.
 *
 * XSS would be able to read this storage: the CSP forbids third-party and
 * inline script on every page that can reach it (docs/SECURITY.md).
 */

export interface StoredCredentials {
  v: 1;
  role: 'admin' | 'member';
  groupId: string;
  memberId?: string;
  /** X25519 secret key, unpadded base64url. */
  secretKey: string;
  token: string;
}

const PREFIX = 'mummer:v1:';
const key = (role: 'admin' | 'member', groupId: string) => `${PREFIX}${role}:${groupId}`;

function storage(): Storage | undefined {
  try {
    const s = window.localStorage;
    const probe = `${PREFIX}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return undefined;
  }
}

export function storageAvailable(): boolean {
  return storage() !== undefined;
}

export function saveCredentials(c: StoredCredentials): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key(c.role, c.groupId), JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

export function loadCredentials(role: 'admin' | 'member', groupId: string): StoredCredentials | undefined {
  const s = storage();
  if (!s) return undefined;
  try {
    const raw = s.getItem(key(role, groupId));
    if (!raw) return undefined;
    const v = JSON.parse(raw) as StoredCredentials;
    if (v.v !== 1 || v.role !== role || v.groupId !== groupId || typeof v.secretKey !== 'string' || typeof v.token !== 'string') return undefined;
    return v;
  } catch {
    return undefined;
  }
}

export function forgetCredentials(role: 'admin' | 'member', groupId: string): void {
  const s = storage();
  try {
    s?.removeItem(key(role, groupId));
    s?.removeItem(`${PREFIX}saved:${role}:${groupId}`);
    s?.removeItem(`${PREFIX}rotation:${groupId}`);
    // Also forget this device's local reveal-day guesses for the exchange.
    if (s) for (const k of Object.keys(s)) if (k.startsWith(`${PREFIX}guess:${groupId}:`)) s.removeItem(k);
  } catch {
    /* nothing to do */
  }
}

/** Remove the secret fragment from the address bar and history entry. */
export function stripFragment(): void {
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  } catch {
    /* ignore */
  }
}

/**
 * "I saved my link" gate: set only after the person pasted their link back and it
 * matched. Until then the invite link is not shown to a host (and a member is asked to save theirs).
 */
export function markLinkSaved(role: 'admin' | 'member', groupId: string): void {
  try {
    storage()?.setItem(`${PREFIX}saved:${role}:${groupId}`, '1');
  } catch {
    /* ignore */
  }
}

export function clearLinkSaved(role: 'admin' | 'member', groupId: string): void {
  try {
    storage()?.removeItem(`${PREFIX}saved:${role}:${groupId}`);
  } catch {
    /* ignore */
  }
}

export function isLinkSaved(role: 'admin' | 'member', groupId: string): boolean {
  try {
    return storage()?.getItem(`${PREFIX}saved:${role}:${groupId}`) === '1';
  } catch {
    return false;
  }
}

/* ---- Link replacement in flight: if the response is lost we can still recover the new credentials ---- */

/** Returns true only when the record was written AND reads back identically: a replacement must never start without a durable copy. */
export function saveRotation(groupId: string, next: StoredCredentials): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const value = JSON.stringify(next);
    const k = `${PREFIX}rotation:${groupId}`;
    s.setItem(k, value);
    return s.getItem(k) === value;
  } catch {
    return false;
  }
}
export function loadRotation(groupId: string): StoredCredentials | undefined {
  try {
    const raw = storage()?.getItem(`${PREFIX}rotation:${groupId}`);
    return raw ? (JSON.parse(raw) as StoredCredentials) : undefined;
  } catch {
    return undefined;
  }
}
export function clearRotation(groupId: string): void {
  try {
    storage()?.removeItem(`${PREFIX}rotation:${groupId}`);
  } catch {
    /* ignore */
  }
}

/* ---- Joined-groups index, so /recover and the home page can offer "continue" without listing secrets ---- */

export function listSavedGroups(): { role: 'admin' | 'member'; groupId: string; memberId?: string }[] {
  const s = storage();
  if (!s) return [];
  const out: { role: 'admin' | 'member'; groupId: string; memberId?: string }[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(PREFIX) || k.startsWith(`${PREFIX}saved:`)) continue;
    const m = /^mummer:v1:(admin|member):([0-9a-f]{32})$/.exec(k);
    if (!m) continue;
    const c = loadCredentials(m[1] as 'admin' | 'member', m[2]!);
    if (c) out.push({ role: c.role, groupId: c.groupId, memberId: c.memberId });
  }
  return out;
}

/* ---- Interrupted-creation safety: one keypair and token per form session ---- */

const PENDING = `${PREFIX}pending-create`;

export interface PendingCreate {
  secretKey: string;
  token: string;
}

export function loadPendingCreate(): PendingCreate | undefined {
  try {
    const raw = window.sessionStorage.getItem(PENDING);
    return raw ? (JSON.parse(raw) as PendingCreate) : undefined;
  } catch {
    return undefined;
  }
}
export function savePendingCreate(p: PendingCreate): void {
  try {
    window.sessionStorage.setItem(PENDING, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export function clearPendingCreate(): void {
  try {
    window.sessionStorage.removeItem(PENDING);
  } catch {
    /* ignore */
  }
}

/* ---- Form drafts (non-secret) so wallet setup detours do not lose typing ---- */

export function loadDraft<T>(name: string): T | undefined {
  try {
    const raw = window.sessionStorage.getItem(`${PREFIX}draft:${name}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
export function saveDraft(name: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(`${PREFIX}draft:${name}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
export function clearDraft(name: string): void {
  try {
    window.sessionStorage.removeItem(`${PREFIX}draft:${name}`);
  } catch {
    /* ignore */
  }
}
