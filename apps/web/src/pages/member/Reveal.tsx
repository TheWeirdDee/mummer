import { useEffect, useState } from 'react';
import type { BundlePlain, RevealView, RosterEntry } from '@mummer/shared';
import { Button, ChoiceGroup, Dialog, Notice, SelectField } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import type { StoredCredentials } from '../../lib/session';

/**
 * Reveal day. Guessing is private (kept only in this browser). A reveal is a
 * deliberate, consented act: the giver proves they held the assignment by
 * entering the memo reference, and chooses who may see it.
 */
export function Reveal({
  gid,
  mid,
  creds,
  roster,
  bundle,
  drawVersion,
  sentOrReceived,
}: {
  gid: string;
  mid: string;
  creds: StoredCredentials;
  roster: RosterEntry[];
  bundle: BundlePlain | undefined;
  drawVersion: number;
  sentOrReceived: boolean;
}) {
  const guessKey = `mummer:v1:guess:${gid}:${mid}`;
  const [guess, setGuess] = useState<string>(() => {
    try {
      return window.localStorage.getItem(guessKey) ?? '';
    } catch {
      return '';
    }
  });
  const [reveals, setReveals] = useState<RevealView[]>([]);
  const [audience, setAudience] = useState<'recipient' | 'group' | undefined>();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const name = (id: string) => roster.find((r) => r.id === id)?.pseudonym ?? 'Someone';
  const load = () => api.reveals(gid, creds.token).then((r) => setReveals(r.reveals), () => undefined);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 20_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, creds.token]);

  const saveGuess = (v: string) => {
    setGuess(v);
    try {
      window.localStorage.setItem(guessKey, v);
    } catch {
      /* guesses are optional */
    }
  };

  const mine = reveals.find((r) => r.giverId === mid);
  const aboutMe = reveals.find((r) => r.recipientId === mid);

  const doReveal = async () => {
    if (!bundle || !audience) return;
    setBusy(true);
    setError('');
    try {
      await api.reveal(gid, creds.token, { drawVersion, recipientId: bundle.recipient.memberId, reference: bundle.reference, audience });
      setDialog(false);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
      setDialog(false);
    }
    setBusy(false);
  };

  const confirm = async (giverId: string) => {
    try {
      await api.confirmReveal(gid, giverId, creds.token);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const others = roster.filter((r) => r.id !== mid && r.status !== 'revoked');

  return (
    <div className="stack">
      <Notice tone="info" title="Reveal day is here">
        <p>You can guess who gave you a gift, and choose whether to reveal who you gave to. Staying a mummer is a perfectly good choice.</p>
      </Notice>

      <section aria-labelledby="guess-title">
        <h3 id="guess-title" style={{ fontSize: 'var(--fs-3)' }}>Who do you think gave to you?</h3>
        <p className="hint" style={{ fontFamily: 'var(--font-ui)' }}>Your guess stays in this browser. Nobody else sees it.</p>
        <SelectField label="My guess" value={guess} onChange={(e) => saveGuess(e.target.value)}>
          <option value="">No guess yet</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>{o.pseudonym}</option>
          ))}
        </SelectField>
        {aboutMe && guess && (
          <Notice tone={aboutMe.giverId === guess ? 'success' : 'info'} live="polite">
            <p>{aboutMe.giverId === guess ? `You guessed right: ${name(aboutMe.giverId)} says they gave to you.` : `${name(aboutMe.giverId)} says they gave to you. Your guess was ${name(guess)}.`}</p>
          </Notice>
        )}
      </section>

      <section aria-labelledby="who-title">
        <h3 id="who-title" style={{ fontSize: 'var(--fs-3)' }}>Reveals so far</h3>
        {reveals.length === 0 ? (
          <p className="muted">No one has revealed yet.</p>
        ) : (
          <ul>
            {reveals.map((r) => (
              <li key={r.giverId}>
                <strong>{name(r.giverId)}</strong> says they gave to <strong>{name(r.recipientId)}</strong>
                {r.audience === 'recipient' ? ' (shared privately)' : ''}.{' '}
                <span className="muted">{r.confirmedByRecipient ? `${name(r.recipientId)} confirmed.` : `Not yet confirmed by ${name(r.recipientId)}.`}</span>
                {r.recipientId === mid && !r.confirmedByRecipient && (
                  <>
                    {' '}
                    <Button size="small" onClick={() => confirm(r.giverId)}>
                      Yes, they gave to me
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
          A reveal is the giver&rsquo;s own statement, checked against the memo reference. It is only shown as agreed by both people once the recipient confirms it.
        </p>
      </section>

      {bundle && (
        <section aria-labelledby="reveal-title">
          <h3 id="reveal-title" style={{ fontSize: 'var(--fs-3)' }}>Reveal who you gave to</h3>
          {mine ? (
            <Notice tone="success" title="You revealed">
              <p>
                You told {mine.audience === 'group' ? 'the group' : name(mine.recipientId)} that you gave to <strong>{name(mine.recipientId)}</strong>.
              </p>
            </Notice>
          ) : (
            <>
              {!sentOrReceived && <p className="muted">Tip: you haven&rsquo;t marked your gift as sent yet. You can still reveal.</p>}
              <ChoiceGroup
                legend="Who may see it?"
                name="audience"
                value={audience}
                onChange={setAudience}
                options={[
                  { value: 'recipient', label: 'Only the person I gave to', detail: 'A private unmasking between the two of you.' },
                  { value: 'group', label: 'Everyone in the group', detail: 'Everyone sees that you say you gave to this person, until they confirm or not.' },
                ]}
              />
              {error && (
                <Notice tone="danger" live="assertive">
                  <p>{error}</p>
                </Notice>
              )}
              <Button variant="primary" disabled={!audience} onClick={() => setDialog(true)}>
                Review and reveal
              </Button>
            </>
          )}
        </section>
      )}

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Unmask?"
        actions={
          <>
            <Button onClick={() => setDialog(false)}>Stay masked</Button>
            <Button variant="primary" onClick={doReveal} loading={busy}>
              Reveal
            </Button>
          </>
        }
      >
        <p>
          You&rsquo;re telling <strong>{audience === 'group' ? 'everyone in the group' : bundle ? bundle.recipient.pseudonym : 'your recipient'}</strong> that you gave to <strong>{bundle?.recipient.pseudonym}</strong>. You can&rsquo;t take this back.
        </p>
        <p className="muted">Mummer checks the memo reference against its stored fingerprint to confirm you held this assignment.</p>
      </Dialog>
    </div>
  );
}
