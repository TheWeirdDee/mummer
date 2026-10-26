import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { hasDraw, LIMITS, type GroupState, type GroupView } from '@mummer/shared';
import { LinkSaver } from '../../components/LinkSaver';
import { PageContainer, useAppChrome } from '../../components/Layout';
import { Badge, Button, Disclosure, Notice, ProgressBar, SkeletonLines } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { addressPreview, formatCalendarDate, formatInstant, formatUsd, plural, untilLabel } from '../../lib/format';
import { useAsync, usePageMeta, usePolling } from '../../lib/hooks';
import { isLinkSaved, type StoredCredentials } from '../../lib/session';
import { useCredentials } from '../../lib/useCredentials';
import { Account } from './Account';
import { Payment } from './Payment';
import { Receive } from './Receive';
import { Reveal } from './Reveal';
import { useAssignment } from './useAssignment';

export function MemberPage() {
  const { gid = '', mid = '' } = useParams();
  usePageMeta('Your exchange | Mummer', 'Your private page in a Mummer exchange: your assignment, payment details and confirmations.', { index: false });
  const { state, reload } = useCredentials('member', gid, mid);

  if (state.status === 'loading') {
    return (
      <PageContainer>
        <h1 className="sr-only">Loading</h1>
        <SkeletonLines lines={6} />
      </PageContainer>
    );
  }
  if (state.status !== 'ready') {
    return (
      <PageContainer narrow>
        <h1>{state.status === 'badlink' ? 'That link is incomplete' : 'Open your private link'}</h1>
        <Notice tone="warn" title={state.status === 'badlink' ? 'Part of the link is missing' : 'This device doesn’t have your key'}>
          <p>
            {state.status === 'badlink'
              ? 'The part after the # carries your key, and it didn’t read correctly. Copy the whole link again from where you saved it.'
              : 'Use the private link you saved when you joined. It includes a long part after the # sign. Mummer can’t recover it for you, because the key never left your browser.'}
          </p>
        </Notice>
        <div className="btn-row">
          <Link to="/recover" className="btn btn--primary">I have a backup</Link>
          <Link to={`/g/${gid}`} className="btn btn--secondary">Join again (before the draw)</Link>
        </div>
      </PageContainer>
    );
  }
  return <Home gid={gid} mid={mid} creds={state.creds} persisted={state.persisted} reloadCreds={reload} />;
}

const STATE_COPY: Record<GroupState, string> = {
  open: 'Waiting for the draw',
  locked: 'Waiting for the draw',
  drawn: 'Names drawn',
  active: 'Gifts in progress',
  needs_resolution: 'Needs attention',
  closed: 'Closed',
};

function Home({ gid, mid, creds, persisted, reloadCreds }: { gid: string; mid: string; creds: StoredCredentials; persisted: boolean; reloadCreds: () => void }) {
  const group = useAsync((s) => api.group(gid, creds.token, s), [gid, creds.token]);
  usePolling(group.reload, 15_000, !!group.data);
  const view = group.data;
  const state = view?.group.state as GroupState | undefined;
  const drawn = state ? hasDraw(state) : false;
  const assignment = useAssignment(gid, mid, creds, drawn && (view?.me?.status ?? '') === 'assigned', view?.group.drawVersion ?? 0);
  const [saved, setSaved] = useState(isLinkSaved('member', gid));
  const [tab, setTab] = useState<'gift' | 'receive' | 'account'>('gift');
  useAppChrome({ title: view?.group.title, role: view?.me?.pseudonym });

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
        <h1>{status === 401 ? 'This link doesn’t work any more' : 'We couldn’t load your exchange'}</h1>
        <Notice tone={status === 401 ? 'warn' : 'danger'}>
          <p>
            {status === 401
              ? 'Your link may have been replaced, you may have been removed, or the exchange may have been deleted or expired. If you replaced your link, use the new one.'
              : group.error.message}
          </p>
        </Notice>
        <div className="btn-row">
          {status !== 401 && <Button onClick={group.reload}>Try again</Button>}
          <Link to="/recover" className="btn btn--secondary">I have a backup</Link>
        </div>
      </PageContainer>
    );
  }
  if (!view || !view.me) return null;
  const g = view.group;
  const me = view.me;
  const st = g.state as GroupState;
  const closed = st === 'closed';
  const bundle = assignment.state.status === 'ready' ? assignment.state.bundle : undefined;

  return (
    <PageContainer>
      <div className="screen-title">
        <h1>{g.title}</h1>
        <Badge tone={st === 'needs_resolution' ? 'wax' : closed ? undefined : 'pine'}>{STATE_COPY[st]}</Badge>
      </div>

      {!persisted && !saved && (
        <Notice tone="warn" title="This browser can’t save your key">
          <p>It’s only in the address bar right now. Save your link below before you close this tab.</p>
        </Notice>
      )}
      {!saved && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <LinkSaver creds={creds} kind="member" title={g.title} onSaved={() => setSaved(true)} />
        </div>
      )}

      {me.status === 'revoked' && (
        <Notice tone="danger" title="You were removed from this exchange">
          <p>Ask the host if this was a mistake.</p>
        </Notice>
      )}

      {st === 'needs_resolution' && (
        <Notice tone="warn" title="The host has flagged this exchange">
          <p>Something needs sorting out as a group, for example someone left after the draw. Check the group chat. If your assignment is still showing below, it still works.</p>
        </Notice>
      )}

      <dl className="facts">
        <div className="fact"><dt>You are</dt><dd>{me.pseudonym}</dd></div>
        <div className="fact"><dt>Budget</dt><dd>about {formatUsd(g.budgetCents)}</dd></div>
        <div className="fact"><dt>Reveal</dt><dd>{formatCalendarDate(g.revealDate, { weekday: 'short', day: 'numeric', month: 'short' })}</dd></div>
        <div className="fact"><dt>People</dt><dd>{view.roster.filter((r) => r.status !== 'revoked').length}</dd></div>
      </dl>

      {!drawn && (
        <WaitingRoom view={view} />
      )}

      {drawn && me.status === 'assigned' && (
        <>
          <div className="tabs" role="tablist" aria-label="Your exchange" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
            {([
              ['gift', 'Your gift to give'],
              ['receive', 'A gift for you'],
              ['account', 'My link'],
            ] as const).map(([k, label]) => (
              <button key={k} id={`tab-${k}`} role="tab" type="button" className="chip" aria-selected={tab === k} aria-pressed={tab === k} aria-controls={`panel-${k}`} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="panel-gift" aria-labelledby="tab-gift" hidden={tab !== 'gift'}>
            <section className="card" aria-labelledby="gift-title">
              <h2 id="gift-title" className="sr-only">Your gift to give</h2>
              {assignment.state.status === 'loading' || assignment.state.status === 'idle' ? (
                <SkeletonLines lines={5} />
              ) : assignment.state.status === 'error' ? (
                <Notice tone="danger" title="We couldn’t open your assignment">
                  <p>{assignment.state.message}</p>
                  <div className="btn-row">
                    <Button onClick={assignment.reload}>Try again</Button>
                    <Link to="/recover" className="btn btn--secondary">Use a backup</Link>
                  </div>
                </Notice>
              ) : assignment.state.status === 'none' ? (
                <Notice tone="warn" title="You don’t have an assignment">
                  <p>The draw didn’t include you. Ask the host.</p>
                </Notice>
              ) : (
                <>
                  <p className="eyebrow">You&rsquo;re giving to</p>
                  <p className="assignment-name">{assignment.state.bundle.recipient.pseudonym}</p>
                  <h3 style={{ fontSize: 'var(--fs-3)' }}>Their wishlist</h3>
                  {assignment.state.bundle.recipient.wishlist ? <p className="wishlist">{assignment.state.bundle.recipient.wishlist}</p> : <p className="muted">They didn&rsquo;t leave a wishlist. Surprise them.</p>}
                  <p className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
                    Their shielded address: <code>{addressPreview(assignment.state.bundle.recipient.address)}</code>. Keep this to yourself: it&rsquo;s a secret between you and the host.
                  </p>
                  <hr />
                  <Payment
                    gid={gid}
                    mid={mid}
                    creds={creds}
                    bundle={assignment.state.bundle}
                    drawVersion={assignment.state.drawVersion}
                    alreadyReportedSent={me.senderState === 'user_reports_sent'}
                    closed={closed}
                    onReported={group.reload}
                  />
                </>
              )}
            </section>
          </div>

          <div role="tabpanel" id="panel-receive" aria-labelledby="tab-receive" hidden={tab !== 'receive'}>
            <section className="card" aria-labelledby="recv-title">
              <h2 id="recv-title" style={{ fontSize: 'var(--fs-4)' }}>A gift for you</h2>
              <Receive gid={gid} mid={mid} creds={creds} drawVersion={g.drawVersion} state={me.recipientState as 'not_acknowledged' | 'recipient_acknowledged' | 'disputed'} closed={closed} onChanged={group.reload} />
            </section>
          </div>

          <div role="tabpanel" id="panel-account" aria-labelledby="tab-account" hidden={tab !== 'account'}>
            <section className="card" aria-labelledby="acct-title">
              <h2 id="acct-title" style={{ fontSize: 'var(--fs-4)' }}>My link</h2>
              <Account gid={gid} mid={mid} creds={creds} title={g.title} bundle={bundle} hasAssignment={me.hasAssignment} drawn={drawn} onCredsChanged={reloadCreds} />
            </section>
          </div>

          <section className="card" style={{ marginTop: 'var(--space-5)' }} aria-labelledby="prog-title">
            <h2 id="prog-title" style={{ fontSize: 'var(--fs-4)' }}>How the group is doing</h2>
            <div className="stack">
              <ProgressBar value={view.progress.reportedSent} max={Math.max(view.progress.assigned, 1)} label={<><span>Givers who say they sent</span><span>{view.progress.reportedSent} / {view.progress.assigned}</span></>} />
              <ProgressBar value={view.progress.acknowledged} max={Math.max(view.progress.assigned, 1)} label={<><span>Gifts confirmed by recipients</span><span>{view.progress.acknowledged} / {view.progress.assigned}</span></>} />
            </div>
            <p className="muted" style={{ marginTop: 'var(--space-3)', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
              Counts only: nobody can see who has sent or confirmed. Both are people&rsquo;s own reports, not proof of payment.
            </p>
          </section>

          {g.revealOpen && !closed && (
            <section className="card" style={{ marginTop: 'var(--space-5)' }} aria-labelledby="reveal-title">
              <h2 id="reveal-title" style={{ fontSize: 'var(--fs-4)' }}>Reveal day</h2>
              <Reveal gid={gid} mid={mid} creds={creds} roster={view.roster} bundle={bundle} drawVersion={g.drawVersion} sentOrReceived={me.senderState === 'user_reports_sent'} />
            </section>
          )}
          {!g.revealOpen && (
            <p className="muted" style={{ marginTop: 'var(--space-5)' }}>
              Reveal opens {formatInstant(g.revealOpensAt, g.timezone)} ({untilLabel(g.revealOpensAt)}).
            </p>
          )}
        </>
      )}

      {!drawn && (
        <Disclosure summary="My link, backup and leaving">
          <Account gid={gid} mid={mid} creds={creds} title={g.title} bundle={undefined} hasAssignment={false} drawn={false} onCredsChanged={reloadCreds} />
        </Disclosure>
      )}
    </PageContainer>
  );
}

function WaitingRoom({ view }: { view: GroupView }) {
  const g = view.group;
  const people = view.roster.filter((r) => r.status !== 'revoked');
  return (
    <section className="card" aria-labelledby="wait-title" style={{ marginBottom: 'var(--space-5)' }}>
      <h2 id="wait-title" style={{ fontSize: 'var(--fs-4)' }}>You&rsquo;re in. Waiting for the draw.</h2>
      <p>
        {g.state === 'open'
          ? `Joining stays open until ${formatInstant(g.joinClosesAt, g.timezone)} (${untilLabel(g.joinClosesAt)}). When the host draws the names, this page updates and shows who you’re giving to.`
          : 'Joining is closed. When the host draws the names, this page updates and shows who you’re giving to.'}
      </p>
      <p className="muted">{plural(people.length, 'person', 'people')} so far (cap {g.memberCap}, at least {LIMITS.minMembersToDraw} needed to draw).</p>
      <ul className="roster" aria-label="People who have joined">
        {people.map((r) => (
          <li key={r.id}>
            <span className="name">{r.pseudonym}</span>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ marginTop: 'var(--space-4)', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
        Keep your private link safe. Nothing is sent to you by email: Mummer has no accounts. Bookmark this page.
      </p>
    </section>
  );
}
