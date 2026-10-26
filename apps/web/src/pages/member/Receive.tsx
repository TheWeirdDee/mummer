import { useState } from 'react';
import { Seal } from '../../components/Mask';
import { Button, Dialog, Notice, TextField } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import type { StoredCredentials } from '../../lib/session';

type RecipientState = 'not_acknowledged' | 'recipient_acknowledged' | 'disputed';

/**
 * A gift for me. Acknowledgment is the recipient's own report. It is labelled that way
 * everywhere and is never presented as verification of payment.
 */
export function Receive({
  gid,
  mid,
  creds,
  drawVersion,
  state,
  closed,
  onChanged,
}: {
  gid: string;
  mid: string;
  creds: StoredCredentials;
  drawVersion: number;
  state: RecipientState;
  closed: boolean;
  onChanged: () => void;
}) {
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'received' | 'problem' | undefined>();
  const [result, setResult] = useState<{ matched: boolean }>();

  const send = async (outcome: 'received' | 'problem') => {
    setBusy(true);
    setError('');
    try {
      const r = await api.ack(gid, mid, creds.token, { drawVersion, outcome, ...(outcome === 'received' && reference.trim() ? { reference: reference.trim() } : {}) });
      setResult({ matched: r.referenceMatched });
      setDialog(undefined);
      onChanged();
    } catch (e) {
      const ae = e as ApiError;
      setError(ae.message);
      setDialog(undefined);
    }
    setBusy(false);
  };

  if (state === 'recipient_acknowledged') {
    return (
      <div className="screen-title" style={{ alignItems: 'flex-start' }}>
        <Seal size="4.5rem" stamp={!!result} />
        <div>
          <Notice tone="success" title="You confirmed this gift">
            <p>
              {result ? (result.matched ? 'Mummer recognises the reference you entered. That doesn’t show that any money was sent.' : 'You confirmed without a reference.') : 'You said you received it.'} This is your own report: Mummer can&rsquo;t see your payment, so it isn&rsquo;t proof of anything on its own.
            </p>
          </Notice>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <p>
        When your gift arrives, your wallet shows a new payment. Open it and look at the memo: it should start with <code>MUMMER</code> and a reference like <code>MUM-XXXX-…</code>. Only you can read it.
      </p>
      {state === 'disputed' && (
        <Notice tone="warn" title="You reported a problem">
          <p>The host can see that someone reported one, not who. If the gift turns up later, you can still confirm it below.</p>
        </Notice>
      )}
      <TextField
        label="Reference from the memo (optional)"
        hint="Mummer can only check that it belongs to a gift for you. It can’t show that money moved, who sent it or how much."
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        className="mono"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="MUM-XXXX-XXXX-XXXX-XXXX-X"
      />
      {error && (
        <Notice tone="danger" title="That didn’t work" live="assertive">
          <p>{error}</p>
        </Notice>
      )}
      <div className="btn-row">
        <Button variant="primary" disabled={closed} onClick={() => setDialog('received')}>
          I received this gift
        </Button>
        {state !== 'disputed' && (
          <Button disabled={closed} onClick={() => setDialog('problem')}>
            I didn&rsquo;t get it, or it looks wrong
          </Button>
        )}
      </div>

      <Dialog
        open={dialog === 'received'}
        onClose={() => setDialog(undefined)}
        title="Confirm you received your gift"
        actions={
          <>
            <Button onClick={() => setDialog(undefined)}>Not yet</Button>
            <Button variant="primary" onClick={() => send('received')} loading={busy}>
              Yes, I received it
            </Button>
          </>
        }
      >
        <p>Only confirm after your wallet shows the payment as received. This adds to the group&rsquo;s count. It&rsquo;s your own word, and it can&rsquo;t be undone.</p>
        {reference.trim() === '' && <p className="muted">You haven&rsquo;t entered a reference, so this will be recorded as a confirmation without one.</p>}
      </Dialog>
      <Dialog
        open={dialog === 'problem'}
        onClose={() => setDialog(undefined)}
        title="Report a problem"
        actions={
          <>
            <Button onClick={() => setDialog(undefined)}>Cancel</Button>
            <Button variant="primary" onClick={() => send('problem')} loading={busy}>
              Report a problem
            </Button>
          </>
        }
      >
        <p>This tells the host that one recipient has a problem, for example nothing arrived or the amount looked wrong. They won&rsquo;t see who. Mummer doesn&rsquo;t know who your giver is, so it can&rsquo;t tell them either: if you want it sorted out, ask in your group.</p>
      </Dialog>
    </div>
  );
}
