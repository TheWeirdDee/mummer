import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LIMITS, hasDraw, type GroupState, type GroupView } from '@mummer/shared';
import { LinkSaver } from '../../components/LinkSaver';
import { PageContainer, useAppChrome } from '../../components/Layout';
import { Badge, Button, CopyField, Dialog, Disclosure, Notice, ProgressBar, SkeletonLines, TextField } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatCalendarDate, formatInstant, formatUsd, plural, untilLabel } from '../../lib/format';
import { useAsync, usePageMeta, usePolling } from '../../lib/hooks';
import { forgetCredentials, isLinkSaved, type StoredCredentials } from '../../lib/session';
import { useCredentials } from '../../lib/useCredentials';
import { DrawPanel } from './DrawPanel';
import { Glassbox } from './Glassbox';

export const STATE_LABEL: Record<GroupState, string> = {
  open: 'Open for joining',
  locked: 'Joining closed',
  drawn: 'Names drawn',
  active: 'Gifts in progress',
  needs_resolution: 'Needs attention',
  closed: 'Closed',
};

export function AdminPage() {
  const { gid = '' } = useParams();
  usePageMeta('Host dashboard | Mummer', 'Manage your Mummer exchange: invite people, draw names and watch progress.', { index: false });
  const { state, reload: reloadCreds } = useCredentials('admin', gid);

  if (state.status === 'loading') {
    return (
      <PageContainer>
        <h1 className="sr-only">Loading your exchange</h1>
        <SkeletonLines lines={6} />
      </PageContainer>
    );
  }
  if (state.status === 'badlink' || state.status === 'missing') {
    return (
      <PageContainer narrow>
        <h1>{state.status === 'badlink' ? 'That admin link is incomplete' : 'Open your admin link'}</h1>
        <Notice tone="warn" title={state.status === 'badlink' ? 'Part of the link is missing' : 'This device doesn’t have the admin key for this exchange'}>
          <p>
            {state.status === 'badlink'
              ? 'The part after the # carries your key, and it didn’t read correctly. Copy the whole link again from where you saved it.'
              : 'Open the admin link you saved when you created the exchange. It includes a long part after the # sign. Mummer can’t recover it, because the key never left your browser.'}
          </p>
        </Notice>
        <div className="btn-row">
          <Link to="/recover" className="btn btn--primary">I have a backup</Link>
          <Link to="/" className="btn btn--secondary">Go home</Link>
        </div>
      </PageContainer>
    );
  }
  return <Dashboard gid={gid} creds={state.creds} persisted={state.persisted} onForget={reloadCreds} />;
}

function Dashboard({ gid, creds, persisted, onForget }: { gid: string; creds: StoredCredentials; persisted: boolean; onForget: () => void }) {
  const group = useAsync((s) => api.group(gid, creds.token, s), [gid, creds.token]);
  usePolling(group.reload, 15_000, !!group.data);
  const [saved, setSaved] = useState(isLinkSaved('admin', gid));
  useAppChrome({ title: group.data?.group.title, role: 'Host' });
  const view = group.data;

  if (group.loading && !view) {
    return (
      <PageContainer>
        <h1 className="sr-only">Loading your exchange</h1>
        <SkeletonLines lines={6} />
      </PageContainer>
    );
  }
  if (group.error && !view) {
    const status = (group.error as ApiError).status;
    return (
      <PageContainer narrow>
        <h1>{status === 401 ? 'This admin link doesn’t work here' : 'We couldn’t load your exchange'}</h1>
        <Notice tone={status === 401 ? 'warn' : 'danger'}>
          <p>{status === 401 ? 'The link may belong to a different exchange, or the exchange was deleted or has expired.' : group.error.message}</p>
        </Notice>
        <div className="btn-row">
          {status !== 401 && <Button onClick={group.reload}>Try again</Button>}
          <Link to="/" className="btn btn--secondary">Go home</Link>
        </div>
      </PageContainer>
    );
  }
  if (!view) return null;

  if (!saved) {
    return (
      <PageContainer narrow>
        <h1 className="sr-only">Save your admin link</h1>
        <div className="screen-title">
          <Badge tone="wax">Step 1 of 2</Badge>
          <p className="lede" style={{ margin: 0 }}>Your exchange &ldquo;{view.group.title}&rdquo; is created. Before anything else, save your admin link.</p>
        </div>
        {!persisted && (
          <Notice tone="warn" title="This browser can’t save the link for you">
            <p>Private browsing or blocked storage means this link is only in the address bar right now. Save it below before leaving this page.</p>
          </Notice>
        )}
        <LinkSaver creds={creds} kind="admin" title={view.group.title} onSaved={() => setSaved(true)} />
      </PageContainer>
    );
  }

  return <Overview gid={gid} creds={creds} view={view} reload={group.reload} onForget={onForget} />;
}

function Overview({ gid, creds, view, reload, onForget }: { gid: string; creds: StoredCredentials; view: GroupView; reload: () => void; onForget: () => void }) {
  const g = view.group;
  const state = g.state as GroupState;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<'delete' | 'close' | 'reset' | 'resolve' | undefined>();
  const [deleteName, setDeleteName] = useState('');
  const invite = `${window.location.origin}/g/${gid}`;
  const p = view.progress;
  const drawn = hasDraw(state);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => setError(''), [g.state]);

  const act = async (label: string, action: string) => {
    setBusy(label);
    setError('');
    try {
      await api.transition(gid, creds.token, action);
      reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
    setBusy('');
    setConfirm(undefined);
  };

  const doDelete = async () => {
    setBusy('delete');
    try {
      await api.deleteGroup(gid, creds.token);
      forgetCredentials('admin', gid);
      window.location.assign('/?deleted=1');
    } catch (e) {
      setError((e as ApiError).message);
      setBusy('');
      setConfirm(undefined);
    }
  };

  const removeAfterDraw = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name}? Their assignment will be dropped and the exchange will be flagged for manual resolution.`)) return;
    try {
      await api.removeMember(gid, id, creds.token);
      reload();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const tone = state === 'needs_resolution' ? 'wax' : state === 'closed' ? undefined : 'pine';

  return (
    <PageContainer>
      <div className="screen-title">
        <h1>{g.title}</h1>
        <Badge tone={tone}>{STATE_LABEL[state]}</Badge>
      </div>

      {error && (
        <Notice tone="danger" title="That didn’t work" live="assertive">
          <p>{error}</p>
        </Notice>
      )}

      <dl className="facts">
        <div className="fact"><dt>Budget</dt><dd>about {formatUsd(g.budgetCents)}</dd></div>
        <div className="fact"><dt>Joining closes</dt><dd>{formatCalendarDate(g.joinDeadline, { weekday: 'short', day: 'numeric', month: 'short' })}{state === 'open' && <span className="muted"> ({untilLabel(g.joinClosesAt)})</span>}</dd></div>
        <div className="fact"><dt>Reveal</dt><dd>{formatCalendarDate(g.revealDate, { weekday: 'short', day: 'numeric', month: 'short' })}</dd></div>
        <div className="fact"><dt>People</dt><dd>{p.ready} of {g.memberCap}</dd></div>
      </dl>

      {state === 'needs_resolution' && (
        <Notice tone="danger" title="This exchange needs attention">
          <p>
            Someone was removed after the draw, or you flagged a problem. Because Mummer never learns who gave to whom, it can&rsquo;t fix this for you. Let the group know, agree how to make up any missing gift, and mark it resolved when you&rsquo;re done.
          </p>
          <Button onClick={() => setConfirm('resolve')}>Mark as resolved</Button>
        </Notice>
      )}

      <div className="panel-grid panel-grid--2">
        <div className="stack">
          {(state === 'open' || state === 'locked') && (
            <section className="card" aria-labelledby="invite-title">
              <h2 id="invite-title" style={{ fontSize: 'var(--fs-4)' }}>Invite people</h2>
              <p>Share this link with your group. It contains no secrets.</p>
              <CopyField label="Invite link" value={invite} mono={false} describe="invite link" />
              <div className="btn-row">
                {canShare && (
                  <Button onClick={() => navigator.share({ title: g.title, text: `Join our Secret Santa: ${g.title}`, url: invite }).catch(() => undefined)}>Share…</Button>
                )}
                {state === 'open' && (
                  <Button onClick={() => act('lock', 'lock')} loading={busy === 'lock'}>
                    Close joining now
                  </Button>
                )}
                {state === 'locked' && Date.parse(g.joinClosesAt) > Date.now() && (
                  <Button onClick={() => act('reopen', 'reopen')} loading={busy === 'reopen'}>
                    Reopen joining
                  </Button>
                )}
              </div>
              {g.hostPlays && (
                <p style={{ marginTop: 'var(--space-4)' }}>
                  You said you&rsquo;re playing too: <Link to={`/g/${gid}`}>join with the invite link</Link> like everyone else.
                </p>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="people-title">
            <h2 id="people-title" style={{ fontSize: 'var(--fs-4)' }}>People ({view.roster.filter((r) => r.status !== 'revoked').length})</h2>
            {view.roster.length === 0 ? (
              <p className="muted">Nobody has joined yet. Share the invite link above.</p>
            ) : (
              <ul className="roster" aria-label="People in this exchange">
                {view.roster.map((r) => (
                  <li key={r.id} data-status={r.status}>
                    <span className="name">{r.pseudonym}</span>
                    {drawn && state !== 'closed' && r.status !== 'revoked' ? (
                      <Button size="small" variant="ghost" onClick={() => removeAfterDraw(r.id, r.pseudonym)} aria-label={`Remove ${r.pseudonym}`}>
                        Remove
                      </Button>
                    ) : (
                      r.status === 'revoked' && <Badge>Removed</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!drawn && p.ready < LIMITS.minMembersToDraw && (
              <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
                You need at least {LIMITS.minMembersToDraw} people to draw ({LIMITS.recommendedMembers}+ is better). {plural(Math.max(0, LIMITS.minMembersToDraw - p.ready), 'more person', 'more people')} to go.
              </p>
            )}
          </section>

          {(state === 'open' || state === 'locked') && (
            <section className="card" aria-labelledby="draw-title">
              <h2 id="draw-title" style={{ fontSize: 'var(--fs-4)' }}>Draw the names</h2>
              <DrawPanel gid={gid} creds={creds} view={view} onDone={reload} />
            </section>
          )}

          {drawn && (
            <section className="card" aria-labelledby="progress-title">
              <h2 id="progress-title" style={{ fontSize: 'var(--fs-4)' }}>Progress</h2>
              <p className="muted">Counts only. Mummer doesn&rsquo;t know who gave to whom, so it can&rsquo;t tell you who is still to send.</p>
              <div className="stack">
                <ProgressBar value={p.reportedSent} max={Math.max(p.assigned, 1)} label={<><span>Givers who say they sent</span><span>{p.reportedSent} / {p.assigned}</span></>} />
                <ProgressBar value={p.acknowledged} max={Math.max(p.assigned, 1)} label={<><span>Gifts confirmed by recipients</span><span>{p.acknowledged} / {p.assigned}</span></>} />
              </div>
              <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
                &ldquo;Sent&rdquo; is each giver&rsquo;s own note, and &ldquo;confirmed&rdquo; is each recipient&rsquo;s own report. Neither is proof of payment.
              </p>
              {p.needsAttention > 0 && (
                <Notice tone="warn" title={`${plural(p.needsAttention, 'recipient')} reported a problem`}>
                  <p>Someone says a gift didn&rsquo;t arrive or looked wrong. You can&rsquo;t see who. A friendly group-wide reminder to check wallets is the best next step.</p>
                </Notice>
              )}
              {g.revealOpen && <p><strong>Reveal day has started.</strong> Participants can now guess and choose to unmask from their own pages.</p>}
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card card--tint" aria-labelledby="next-title">
            <h2 id="next-title" style={{ fontSize: 'var(--fs-4)' }}>What happens next</h2>
            <NextSteps state={state} revealOpensAt={g.revealOpensAt} timezone={g.timezone} />
          </section>

          <section className="card" aria-labelledby="manage-title">
            <h2 id="manage-title" style={{ fontSize: 'var(--fs-4)' }}>Manage</h2>
            <div className="stack">
              {state === 'drawn' && (
                <div>
                  <p>No one has reported sending yet, so you can still redraw from scratch.</p>
                  <Button onClick={() => setConfirm('reset')}>Redraw from scratch</Button>
                </div>
              )}
              {(state === 'drawn' || state === 'active') && (
                <div>
                  <p>Something went wrong that needs people to sort out together?</p>
                  <Button onClick={() => act('flag', 'flag_resolution')} loading={busy === 'flag'}>Flag as needing attention</Button>
                </div>
              )}
              {state !== 'closed' && (
                <div>
                  <p>Closing archives the exchange. Nobody can send, confirm or reveal after that.</p>
                  <Button onClick={() => setConfirm('close')}>Close the exchange</Button>
                </div>
              )}
              <div>
                <p>Deleting removes every row the server holds for this exchange, immediately. It can&rsquo;t remove screenshots or blockchain records.</p>
                <Button variant="danger" onClick={() => setConfirm('delete')}>Delete the exchange</Button>
              </div>
            </div>
          </section>

          <section aria-label="More">
            <Disclosure summary="What Mummer’s server stores for this exchange">
              <Glassbox gid={gid} token={creds.token} />
            </Disclosure>
            <Disclosure summary="Show my admin link or make a backup">
              <LinkSaverAgain creds={creds} title={g.title} />
            </Disclosure>
          </section>
        </div>
      </div>

      <Dialog
        open={confirm === 'close'}
        onClose={() => setConfirm(undefined)}
        title="Close this exchange?"
        actions={
          <>
            <Button onClick={() => setConfirm(undefined)}>Keep it open</Button>
            <Button variant="primary" onClick={() => act('close', 'close')} loading={busy === 'close'}>Close it</Button>
          </>
        }
      >
        <p>It becomes read-only. Nobody can send, confirm or reveal after this. You can still delete it later.</p>
      </Dialog>
      <Dialog
        open={confirm === 'reset'}
        onClose={() => setConfirm(undefined)}
        title="Redraw from scratch?"
        actions={
          <>
            <Button onClick={() => setConfirm(undefined)}>Cancel</Button>
            <Button variant="primary" onClick={() => act('reset', 'reset_draw')} loading={busy === 'reset'}>Discard this draw</Button>
          </>
        }
      >
        <p>The current assignments are discarded and everyone&rsquo;s old assignment stops working. You&rsquo;ll draw again and people will open new assignments.</p>
      </Dialog>
      <Dialog
        open={confirm === 'resolve'}
        onClose={() => setConfirm(undefined)}
        title="Mark as resolved?"
        actions={
          <>
            <Button onClick={() => setConfirm(undefined)}>Not yet</Button>
            <Button variant="primary" onClick={() => act('resolve', 'clear_resolution')} loading={busy === 'resolve'}>Mark resolved</Button>
          </>
        }
      >
        <p>This only clears the flag. It doesn&rsquo;t change any assignments.</p>
      </Dialog>
      <Dialog
        open={confirm === 'delete'}
        onClose={() => { setConfirm(undefined); setDeleteName(''); }}
        title="Delete this exchange?"
        actions={
          <>
            <Button onClick={() => { setConfirm(undefined); setDeleteName(''); }}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} loading={busy === 'delete'} disabled={deleteName.trim() !== g.title}>Delete everything</Button>
          </>
        }
      >
        <p>This permanently removes the exchange, its people, assignments and counts from Mummer&rsquo;s server. It can&rsquo;t be undone.</p>
        <TextField label={`Type “${g.title}” to confirm`} value={deleteName} onChange={(e) => setDeleteName(e.target.value)} autoComplete="off" />
      </Dialog>
    </PageContainer>
  );
}

function LinkSaverAgain({ creds, title }: { creds: StoredCredentials; title: string }) {
  // Re-uses the saver for copy/backup, without gating anything.
  return <LinkSaver creds={creds} kind="admin" title={title} onSaved={() => undefined} embedded />;
}

function NextSteps({ state, revealOpensAt, timezone }: { state: GroupState; revealOpensAt: string; timezone: string }) {
  const reveal = `${formatInstant(revealOpensAt, timezone)} (${timezone.replace(/_/g, ' ')})`;
  const steps: Record<GroupState, string[]> = {
    open: ['Share the invite link.', 'When at least four people are ready, review and draw. You can also draw early and close joining.', 'After the draw, everyone opens their own assignment from their private link.'],
    locked: ['Joining is closed. Review the list of people.', 'Draw the names when you’re ready.', 'After the draw, everyone opens their own assignment from their private link.'],
    drawn: ['Let your group know the names are drawn.', 'Givers open their pages, check the payment request in their wallets and send.', `Reveal opens ${reveal}.`],
    active: ['Givers send from their own wallets and note it here.', 'Recipients confirm what arrived.', `Reveal opens ${reveal}.`],
    needs_resolution: ['Talk to the group. Mummer can’t tell who is affected.', 'Agree how to make up any missing gift.', 'Mark the exchange resolved.'],
    closed: ['The exchange is archived and read-only.', 'It will be deleted automatically 30 days after the reveal date.', 'You can delete it sooner.'],
  };
  return (
    <ol>
      {steps[state].map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}
