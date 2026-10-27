import { useEffect, useRef, useState } from 'react';
import { loadCrypto } from './cryptoClient';
import { probeToken } from './credentialRecovery';
import { loadCredentials, saveCredentials, stripFragment, type StoredCredentials } from './session';

export type CredentialState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'badlink' }
  | { status: 'conflict'; incoming: StoredCredentials; stored: StoredCredentials }
  | { status: 'ready'; creds: StoredCredentials; publicKey: string; fromLink: boolean; persisted: boolean; /** The link that was opened has been replaced; the key saved on this device still works. */ staleLink?: boolean };

/**
 * Resolve this page's credentials: the private link's fragment first (then saved
 * on this device and removed from the address bar), otherwise what this browser
 * saved earlier. The secret key never leaves the browser; the token is sent only
 * in an Authorization header.
 */
export function useCredentials(role: 'admin' | 'member', groupId: string, memberId?: string): { state: CredentialState; reload: () => void; resolveConflict: (useLink: boolean) => void } {
  const [state, setState] = useState<CredentialState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  // A link the person chose that this browser would not store: used from memory, and its fragment stays in the address bar.
  const memory = useRef<StoredCredentials | undefined>(undefined);

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
      let staleLink = false;

      if (memory.current) {
        creds = memory.current;
        fromLink = true;
      } else if (hash && hash.length > 1) {
        const parsed = crypto.parseFragment(hash);
        if (!parsed) {
          if (!cancelled) setState({ status: 'badlink' });
          return;
        }
        creds = { v: 1, role, groupId, ...(memberId ? { memberId } : {}), secretKey: crypto.encodeKey(parsed.secretKey), token: parsed.token };
        // A link that differs from what this device already saved must not silently overwrite it: ask first.
        const existing = loadCredentials(role, groupId);
        let differs = !!existing && (existing.secretKey !== creds.secretKey || existing.token !== creds.token);
        if (differs && existing) {
          // Ask the server which of the two still works. Only when BOTH do (or we can't tell) is it a real choice.
          const [incoming, stored] = await Promise.all([probeToken(groupId, creds.token), probeToken(groupId, existing.token)]);
          if (cancelled) return;
          if (incoming === 'rejected' && stored === 'ok') {
            creds = existing;
            staleLink = true;
            stripFragment();
            differs = false;
            persisted = true;
          } else if (incoming === 'ok' && stored === 'rejected') {
            differs = false; // the saved key is dead and the link is live: use the link
          }
        }
        if (differs && existing) {
          if (!cancelled) setState({ status: 'conflict', incoming: creds, stored: existing });
          return;
        }
        if (!staleLink) {
          fromLink = true;
          persisted = saveCredentials(creds);
          if (persisted) stripFragment();
        }
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
        setState({ status: 'ready', creds, publicKey: pk, fromLink, persisted, ...(staleLink ? { staleLink } : {}) });
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
    if (useLink) {
      if (saveCredentials(state.incoming)) stripFragment();
      else memory.current = state.incoming; // could not be stored: keep it in memory and leave the fragment so a reload still works
    } else {
      stripFragment();
    }
    setNonce((n) => n + 1);
  };

  return { state, reload: () => setNonce((n) => n + 1), resolveConflict };
}
