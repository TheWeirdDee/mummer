import { api, ApiError } from './api';
import { clearLinkSaved, clearRotation, loadRotation, saveCredentials } from './session';

/**
 * Does the server currently accept this token for this exchange?
 * 'rejected' means a definite 401: the token was replaced, revoked or never registered.
 * 'unknown' covers everything else (offline, server error, deleted exchange): never treat it as a verdict.
 */
export async function probeToken(gid: string, token: string): Promise<'ok' | 'rejected' | 'unknown'> {
  try {
    await api.group(gid, token);
    return 'ok';
  } catch (e) {
    return e instanceof ApiError && e.status === 401 ? 'rejected' : 'unknown';
  }
}

/**
 * A link replacement writes its new credentials to this device BEFORE the request, so a lost reply cannot strand anyone.
 * This settles such a record: if the server accepts the pending token the replacement did happen and the new credentials
 * are adopted (and the person must save the new link again); if the server rejects it the replacement never happened and
 * the record is dropped. A pending token the server does not accept can therefore never be used, so access that was
 * revoked (for example by the host removing the member) is never restored by this path.
 */
export async function adoptPendingRotation(gid: string, currentToken: string): Promise<'adopted' | 'none' | 'unknown'> {
  const pending = loadRotation(gid);
  if (!pending || pending.token === currentToken) return 'none';
  const verdict = await probeToken(gid, pending.token);
  if (verdict === 'ok') {
    saveCredentials(pending);
    clearRotation(gid);
    clearLinkSaved(pending.role, gid);
    return 'adopted';
  }
  if (verdict === 'rejected') {
    clearRotation(gid);
    return 'none';
  }
  return 'unknown';
}
