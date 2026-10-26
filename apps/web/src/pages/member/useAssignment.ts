import { useCallback, useEffect, useState } from 'react';
import type { BundlePlain } from '@mummer/shared';
import { api, ApiError } from '../../lib/api';
import { loadCrypto } from '../../lib/cryptoClient';
import type { StoredCredentials } from '../../lib/session';

export type AssignmentState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bundle: BundlePlain; drawVersion: number; sealed: string };

/**
 * Fetch and open this member's sealed assignment. It exists decrypted only in
 * component state (memory): it is never written to storage.
 */
export function useAssignment(gid: string, mid: string, creds: StoredCredentials, enabled: boolean, expectedDrawVersion: number) {
  const [state, setState] = useState<AssignmentState>({ status: 'idle' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const c = await loadCrypto();
      const sk = c.decodeKey(creds.secretKey);
      const pk = c.publicKeyFromSecret(sk);
      const res = await api.assignment(gid, mid, creds.token);
      // The expected draw version is the GROUP's current one, not whatever the server says the bundle is: a stale bundle is refused.
      if (res.drawVersion !== expectedDrawVersion) throw new ApiError(409, 'draw_mismatch', 'Your assignment is out of date. Reload the page.');
      const bundle = c.openAssignment(res.sealedBundle, pk, sk, { groupId: gid, memberId: mid, drawVersion: expectedDrawVersion });
      setState({ status: 'ready', bundle, drawVersion: res.drawVersion, sealed: res.sealedBundle });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ status: 'none' });
      else if (e instanceof ApiError) setState({ status: 'error', message: e.message });
      else setState({ status: 'error', message: 'We couldn’t open your assignment on this device. The key in this browser may not match. Use your saved private link or backup.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, mid, creds.token, creds.secretKey, expectedDrawVersion]);

  // Re-open when a draw appears or the draw version changes (a redraw issues a new assignment).
  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, expectedDrawVersion, load]);

  return { state, reload: load };
}
