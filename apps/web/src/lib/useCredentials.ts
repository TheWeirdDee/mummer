import { useEffect, useState } from 'react';
import { loadCrypto } from './cryptoClient';
import { loadCredentials, saveCredentials, stripFragment, type StoredCredentials } from './session';

export type CredentialState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'badlink' }
  | { status: 'conflict'; incoming: StoredCredentials; stored: StoredCredentials }
  | { status: 'ready'; creds: StoredCredentials; publicKey: string; fromLink: boolean; persisted: boolean };

/**
 * Resolve this page's credentials: the private link's fragment first (then saved
 * on this device and removed from the address bar), otherwise what this browser
 * saved earlier. The secret key never leaves the browser; the token is sent only
 * in an Authorization header.
 */
export function useCredentials(role: 'admin' | 'member', groupId: string, memberId?: string): { state: CredentialState; reload: () => void; resolveConflict: (useLink: boolean) => void } {
  const [state, setState] = useState<CredentialState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  // Pasting a private link into a tab that is already on this page only changes the fragment: pick it up.
  useEffect(() => {
    const onHash = () => setNonce((n) => n + 1);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const crypto = await loadCrypto();
      const hash = window.location.hash;
      let creds: StoredCredentials | undefined;
      let fromLink = false;
      let persisted = false;

      if (hash && hash.length > 1) {
        const parsed = crypto.parseFragment(hash);
        if (!parsed) {
          if (!cancelled) setState({ status: 'badlink' });
          return;
        }
        creds = { v: 1, role, groupId, ...(memberId ? { memberId } : {}), secretKey: crypto.encodeKey(parsed.secretKey), token: parsed.token };
        // A link that differs from what this device already saved must not silently overwrite it: ask first.
        const existing = loadCredentials(role, groupId);
        if (existing && (existing.secretKey !== creds.secretKey || existing.token !== creds.token)) {
          if (!cancelled) setState({ status: 'conflict', incoming: creds, stored: existing });
          return;
        }
        fromLink = true;
        persisted = saveCredentials(creds);
        if (persisted) stripFragment();
      } else {
        const stored = loadCredentials(role, groupId);
        if (stored && (role === 'admin' || stored.memberId === memberId)) {
          creds = stored;
          persisted = true;
        }
      }
      if (cancelled) return;
      if (!creds) {
        setState({ status: 'missing' });
        return;
      }
      try {
        const pk = crypto.encodeKey(crypto.publicKeyFromSecret(crypto.decodeKey(creds.secretKey)));
        setState({ status: 'ready', creds, publicKey: pk, fromLink, persisted });
      } catch {
        setState({ status: 'badlink' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, groupId, memberId, nonce]);

  const resolveConflict = (useLink: boolean) => {
    if (state.status !== 'conflict') return;
    if (useLink) saveCredentials(state.incoming);
    stripFragment();
    setNonce((n) => n + 1);
  };

  return { state, reload: () => setNonce((n) => n + 1), resolveConflict };
}
