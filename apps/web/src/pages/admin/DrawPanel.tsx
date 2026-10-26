import { useMemo, useState } from 'react';
import { LIMITS, type GroupView } from '@mummer/shared';
import { runDraw, type Exclusion } from '@mummer/draw';
import { validateGiftAddress } from '@mummer/zcash';
import type { ProfilePlain } from '@mummer/shared';
import { Button, Dialog, Notice, SelectField } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { loadCrypto } from '../../lib/cryptoClient';
import { loadDraft, saveDraft, clearDraft, type StoredCredentials } from '../../lib/session';

interface Candidate {
  id: string;
  pseudonym: string;
  publicKey: string;
  profile?: ProfilePlain;
  problem?: string;
}

type Phase = 'idle' | 'loading' | 'review' | 'drawing' | 'done';

/**
 * The host-side draw. Everything here happens in this browser: profiles are opened
 * with the host key, addresses are re-validated, the draw runs on the CSPRNG, and
 * only sealed bundles and commitments (sorted by member id) are sent to the server.
 * Pairings are never displayed and never stored; they exist in memory only for the
 * duration of this function, which the UI says plainly.
 */
export function DrawPanel({ gid, creds, view, onDone }: { gid: string; creds: StoredCredentials; view: GroupView; onDone: () => void }) {
  const g = view.group;
  const [phase, setPhase] = useState<Phase>('idle');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [exclusions, setExclusions] = useState<[string, string][]>([]);
  const [pairA, setPairA] = useState('');
  const [pairB, setPairB] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [removing, setRemoving] = useState<Candidate>();

  const earlyClose = g.state === 'open';
  const valid = useMemo(() => candidates.filter((c) => c.profile && !c.problem), [candidates]);
  const flagged = candidates.filter((c) => c.problem);

  const loadProfiles = async () => {
    setError('');
    setPhase('loading');
    try {
      const c = await loadCrypto();
      const hostSecret = c.decodeKey(creds.secretKey);
      const hostPublic = c.publicKeyFromSecret(hostSecret);
      const res = await api.profiles(gid, creds.token);
      const out: Candidate[] = res.members.map((m) => {
        try {
          const profile = c.openProfile(m.sealedProfile, hostPublic, hostSecret, { groupId: gid, pseudonym: m.pseudonym });
          const check = validateGiftAddress(profile.address);
          if (!check.ok) return { id: m.memberId, pseudonym: m.pseudonym, publicKey: m.publicKey, problem: `Their address can’t be used: ${check.message}` };
          return { id: m.memberId, pseudonym: m.pseudonym, publicKey: m.publicKey, profile: { ...profile, address: check.address } };
        } catch {
          return { id: m.memberId, pseudonym: m.pseudonym, publicKey: m.publicKey, problem: 'Their details couldn’t be opened. Ask them to rejoin.' };
        }
      });
      setCandidates(out);
      setPhase('review');
    } catch (e) {
      setError((e as ApiError).message || 'We couldn’t load the member details.');
      setPhase('idle');
    }
  };

  const addPair = () => {
    if (!pairA || !pairB || pairA === pairB) return;
    if (exclusions.some(([a, b]) => (a === pairA && b === pairB) || (a === pairB && b === pairA))) return;
    setExclusions([...exclusions, [pairA, pairB]]);
    setPairA('');
    setPairB('');
  };

  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.pseudonym ?? 'Unknown';

  const doDraw = async () => {
    setError('');
    setNote('');
    setPhase('drawing');
    try {
      const c = await loadCrypto();
      const members = valid.map((v) => ({ id: v.id, publicKey: v.publicKey, profile: v.profile! }));
      const ex: Exclusion[] = exclusions.flatMap(([a, b]) => [
        { giver: a, recipient: b },
        { giver: b, recipient: a },
      ]);
      const result = runDraw({ memberIds: members.map((m) => m.id), exclusions: ex });
      if (!result.ok) {
        const msg: Record<string, string> = {
          too_few_members: `At least ${LIMITS.minMembersToDraw} people are needed.`,
          member_has_no_possible_recipient: `${'id' in result ? nameOf(result.id) : 'Someone'} has nobody left to give to. Remove one of their exclusions.`,
          member_has_no_possible_giver: `${'id' in result ? nameOf(result.id) : 'Someone'} would have nobody to receive from. Remove one of their exclusions.`,
          unsatisfiable: 'No arrangement satisfies all of those exclusions. Remove some and try again.',
          search_limit_reached: 'We couldn’t find an arrangement within a reasonable time. Try removing an exclusion.',
        };
        throw new ApiError(0, 'unknown', msg[result.reason] ?? 'The draw could not be completed.');
      }
      const version = g.drawVersion + 1;
      const payload = c.buildDrawPayload({ groupId: gid, drawVersion: version, budgetCents: g.budgetCents, members, assignments: result.assignments });
      // A retry of the same draw (after a network failure or reload) reuses the key, so it can never become a second draw.
      const keyName = `draw-key:${gid}:${version}`;
      let key = loadDraft<string>(keyName);
      if (!key) {
        key = c.generateToken().slice(0, 32);
        saveDraft(keyName, key);
      }
      const res = await api.draw(gid, creds.token, key, { drawVersion: version, ...(earlyClose ? { closeEarly: true } : {}), ...payload });
      clearDraft(keyName);
      setPhase('done');
      setNote(res.replay ? 'This draw had already been saved. Everything is in place.' : '');
      onDone();
    } catch (e) {
      const ae = e as ApiError;
      setError(ae.message || 'The draw could not be saved. Nothing was changed.');
      setPhase('review');
      if (ae.code === 'draw_mismatch') await loadProfiles();
    }
  };

  const remove = async (c: Candidate) => {
    try {
      await api.removeMember(gid, c.id, creds.token);
      setCandidates((cs) => cs.filter((x) => x.id !== c.id));
      setExclusions((ex) => ex.filter(([a, b]) => a !== c.id && b !== c.id));
      setRemoving(undefined);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
      setRemoving(undefined);
    }
  };

  if (phase === 'done') {
    return (
      <Notice tone="success" title="The names are drawn" live="polite">
        <p>Everyone can now open their assignment from their private link. This page didn&rsquo;t show you the pairings and doesn&rsquo;t keep them.</p>
        {note && <p>{note}</p>}
      </Notice>
    );
  }

  const readyEnough = valid.length >= LIMITS.minMembersToDraw && flagged.length === 0;

  return (
    <div className="stack">
      {error && (
        <Notice tone="danger" title="Something needs attention" live="assertive">
          <p>{error}</p>
        </Notice>
      )}

      {phase === 'idle' && (
        <>
          <p>
            Ready when you are. First we&rsquo;ll open everyone&rsquo;s details <strong>in this browser</strong> to check them, then you can add exclusions and draw.
          </p>
          <div className="btn-row">
            <Button variant="primary" onClick={loadProfiles} disabled={view.progress.ready < LIMITS.minMembersToDraw}>
              Review people and draw
            </Button>
            {view.progress.ready < LIMITS.minMembersToDraw && <span className="muted">Needs at least {LIMITS.minMembersToDraw} people ({view.progress.ready} so far).</span>}
          </div>
        </>
      )}

      {phase === 'loading' && <p role="status">Opening everyone&rsquo;s details in your browser…</p>}

      {(phase === 'review' || phase === 'drawing') && (
        <>
          <ul className="roster" aria-label="People in this draw">
            {candidates.map((c) => (
              <li key={c.id} data-problem={!!c.problem}>
                <span className="name">
                  {c.problem ? '⚠ ' : '✓ '}
                  {c.pseudonym}
                </span>
                <Button size="small" onClick={() => setRemoving(c)} aria-label={`Remove ${c.pseudonym}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {flagged.map((c) => (
            <Notice key={c.id} tone="warn" title={`${c.pseudonym} needs attention`}>
              <p>
                {c.problem} Remove them so they can rejoin, or the draw can&rsquo;t go ahead.
              </p>
            </Notice>
          ))}

          <details className="disclosure">
            <summary>Exclusions: people who shouldn&rsquo;t draw each other (optional)</summary>
            <div className="disclosure__body">
              <p>For partners or housemates. These stay in your browser and are never sent to Mummer. Each pair is blocked in both directions.</p>
              {exclusions.length > 0 && (
                <ul>
                  {exclusions.map(([a, b], i) => (
                    <li key={`${a}-${b}`}>
                      {nameOf(a)} ↔ {nameOf(b)}{' '}
                      <Button size="small" variant="ghost" onClick={() => setExclusions(exclusions.filter((_, j) => j !== i))} aria-label={`Remove exclusion ${nameOf(a)} and ${nameOf(b)}`}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid-2">
                <SelectField label="First person" value={pairA} onChange={(e) => setPairA(e.target.value)}>
                  <option value="">Choose…</option>
                  {valid.map((v) => (
                    <option key={v.id} value={v.id}>{v.pseudonym}</option>
                  ))}
                </SelectField>
                <SelectField label="Second person" value={pairB} onChange={(e) => setPairB(e.target.value)}>
                  <option value="">Choose…</option>
                  {valid.filter((v) => v.id !== pairA).map((v) => (
                    <option key={v.id} value={v.id}>{v.pseudonym}</option>
                  ))}
                </SelectField>
              </div>
              <Button onClick={addPair} disabled={!pairA || !pairB}>Add exclusion</Button>
            </div>
          </details>

          <Notice tone="warn" title="Before you draw">
            <p>
              Your browser will hold the pairings for a moment while it seals each one for its giver. This page won&rsquo;t show them or save them, but you could in principle have copied them, which is why we call this a trusted-host draw.
              {earlyClose && ' Drawing now also closes joining for everyone else.'}
            </p>
          </Notice>
          <div className="btn-row">
            <Button
              variant="primary"
              size="large"
              loading={phase === 'drawing'}
              disabled={!readyEnough}
              onClick={() => (earlyClose ? setConfirmEarly(true) : doDraw())}
            >
              Draw names for {valid.length} {valid.length === 1 ? 'person' : 'people'}
            </Button>
            {!readyEnough && <span className="muted">{flagged.length > 0 ? 'Resolve the flagged people first.' : `Needs at least ${LIMITS.minMembersToDraw} ready people.`}</span>}
          </div>
          {valid.length === LIMITS.minMembersToDraw && (
            <p className="muted">Heads up: with exactly {LIMITS.minMembersToDraw} people, each person can work out more about who gave to whom. {LIMITS.recommendedMembers} or more is better.</p>
          )}
        </>
      )}

      <Dialog
        open={confirmEarly}
        onClose={() => setConfirmEarly(false)}
        title="Close joining and draw now?"
        actions={
          <>
            <Button onClick={() => setConfirmEarly(false)}>Not yet</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmEarly(false);
                void doDraw();
              }}
            >
              Close joining and draw
            </Button>
          </>
        }
      >
        <p>The join deadline hasn&rsquo;t passed yet. Drawing now means nobody else can join. This can&rsquo;t be undone, though you can redraw before anyone reports sending.</p>
      </Dialog>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(undefined)}
        title={`Remove ${removing?.pseudonym ?? ''}?`}
        actions={
          <>
            <Button onClick={() => setRemoving(undefined)}>Keep them</Button>
            <Button variant="danger" onClick={() => removing && remove(removing)}>
              Remove
            </Button>
          </>
        }
      >
        <p>They&rsquo;ll lose access and their name becomes available again. They can rejoin with a new link while joining is open.</p>
      </Dialog>
    </div>
  );
}
