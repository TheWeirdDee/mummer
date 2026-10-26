import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BundlePlain } from '@mummer/shared';
import { LinkSaver } from '../../components/LinkSaver';
import { Button, Dialog, Notice } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { loadCrypto } from '../../lib/cryptoClient';
import { clearLinkSaved, forgetCredentials, saveCredentials, type StoredCredentials } from '../../lib/session';

/** Link safety and recovery: back up, replace a possibly leaked link, leave, or forget this device. */
export function Account({
  gid,
  mid,
  creds,
  title,
  bundle,
  hasAssignment,
  drawn,
  onReplaced,
}: {
  gid: string;
  mid: string;
  creds: StoredCredentials;
  title: string;
  bundle: BundlePlain | undefined;
  hasAssignment: boolean;
  drawn: boolean;
  /** Called after the link was replaced and the new credentials were saved on this device. The page must then ask the person to save the NEW link. */
  onReplaced: () => void;
}) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'rotate' | 'leave' | 'forget' | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rotate = async () => {
    setBusy(true);
    setError('');
    try {
      if (hasAssignment && !bundle) throw new ApiError(0, 'unknown', 'Open your assignment first, then replace the link, so it can be re-sealed to your new key.');
      const c = await loadCrypto();
      const kp = await c.generateKeyPair();
      const token = c.generateToken();
      const body = {
        newTokenHash: c.hashToken(token),
        newPublicKey: c.encodeKey(kp.publicKey),
        ...(bundle ? { newSealedBundle: c.resealAssignment(bundle, c.encodeKey(kp.publicKey)) } : {}),
      };
      await api.rotate(gid, mid, creds.token, body);
      const next: StoredCredentials = { v: 1, role: 'member', groupId: gid, memberId: mid, secretKey: c.encodeKey(kp.secretKey), token };
      // The old link is already dead server-side. Keep the new credentials on this device, require the new link to be
      // saved again, and let the page (which survives the credential change) show the save-your-link step.
      saveCredentials(next);
      clearLinkSaved('member', gid);
      setDialog(undefined);
      onReplaced();
    } catch (e) {
      setError((e as ApiError).message);
      setDialog(undefined);
    }
    setBusy(false);
  };

  const leave = async () => {
    setBusy(true);
    try {
      await api.leave(gid, mid, creds.token);
      forgetCredentials('member', gid);
      navigate(`/g/${gid}`, { replace: true });
    } catch (e) {
      setError((e as ApiError).message);
      setDialog(undefined);
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {error && (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      )}
      <div>
        <h3 style={{ fontSize: 'var(--fs-3)' }}>Back up or re-copy my link</h3>
        <LinkSaver creds={creds} kind="member" title={title} onSaved={() => undefined} embedded />
      </div>
      <div>
        <h3 style={{ fontSize: 'var(--fs-3)' }}>Replace my link</h3>
        <p>If your link may have been seen by someone else, replace it. The old link stops working immediately and your assignment is re-sealed to a new key.</p>
        <p className="muted">Anyone who already opened your page with the old link could have seen what you could see.</p>
        <Button onClick={() => setDialog('rotate')}>Replace my link</Button>
      </div>
      <div>
        <h3 style={{ fontSize: 'var(--fs-3)' }}>{drawn ? 'Leave this exchange' : 'Leave or change my details'}</h3>
        <p>
          {drawn
            ? 'Leaving after the draw can leave someone without a giver. The host is told the exchange needs attention, though not who is affected.'
            : 'To change your nickname, wishlist or address, leave and join again. Your name becomes available straight away.'}
        </p>
        <Button variant="danger" onClick={() => setDialog('leave')}>
          Leave the exchange
        </Button>
      </div>
      <div>
        <h3 style={{ fontSize: 'var(--fs-3)' }}>Forget this device</h3>
        <p>Removes your saved key from this browser. You&rsquo;ll need your link or backup to get back in.</p>
        <Button onClick={() => setDialog('forget')}>Forget this device</Button>
      </div>

      <Dialog
        open={dialog === 'rotate'}
        onClose={() => setDialog(undefined)}
        title="Replace your link?"
        actions={
          <>
            <Button onClick={() => setDialog(undefined)}>Cancel</Button>
            <Button variant="primary" onClick={rotate} loading={busy}>Replace it</Button>
          </>
        }
      >
        <p>You&rsquo;ll get a new private link to save. The current one stops working.</p>
      </Dialog>
      <Dialog
        open={dialog === 'leave'}
        onClose={() => setDialog(undefined)}
        title="Leave this exchange?"
        actions={
          <>
            <Button onClick={() => setDialog(undefined)}>Stay</Button>
            <Button variant="danger" onClick={leave} loading={busy}>Leave</Button>
          </>
        }
      >
        <p>{drawn ? 'Your assignment will be dropped and the exchange will be flagged for the host to sort out.' : 'You will be removed and can rejoin while joining is open.'}</p>
      </Dialog>
      <Dialog
        open={dialog === 'forget'}
        onClose={() => setDialog(undefined)}
        title="Forget this device?"
        actions={
          <>
            <Button onClick={() => setDialog(undefined)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                forgetCredentials('member', gid);
                navigate('/', { replace: true });
              }}
            >
              Forget it
            </Button>
          </>
        }
      >
        <p>Make sure you&rsquo;ve saved your private link or a backup first. Without one, you can&rsquo;t get back in.</p>
      </Dialog>
    </div>
  );
}
