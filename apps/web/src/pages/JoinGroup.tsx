import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LIMITS } from '@mummer/shared';
import { validateGiftAddress, type GiftAddressResult } from '@mummer/zcash';
import { HumanCheck, type HumanCheckState } from '../components/HumanCheck';
import { LinkSaver } from '../components/LinkSaver';
import { PageContainer, useAppChrome } from '../components/Layout';
import { Seal } from '../components/Mask';
import { Button, CheckField, ChoiceGroup, ErrorSummary, LinkButton, Notice, SkeletonLines, Steps, TextAreaField, TextField } from '../components/ui';
import { api, ApiError, type PublicConfig } from '../lib/api';
import { loadCrypto } from '../lib/cryptoClient';
import { addressTail, formatCalendarDate, formatUsd, plural, untilLabel } from '../lib/format';
import { useAsync, usePageMeta } from '../lib/hooks';
import { clearDraft, isLinkSaved, loadCredentials, loadDraft, saveCredentials, saveDraft, type StoredCredentials } from '../lib/session';

interface Draft {
  name: string;
  wishlist: string;
  wallet?: 'have' | 'find' | 'none';
}
interface KeyDraft {
  secretKey: string;
  token: string;
}

const STEPS = ['You', 'Wallet', 'Address', 'Review'];

export function JoinGroup() {
  const { gid = '' } = useParams();
  usePageMeta('Join a Mummer exchange', 'Join a Secret Santa exchange with private shielded gifts. Pick a nickname, add a wishlist and a shielded address.', { index: false });
  const invite = useAsync((s) => api.invite(gid).then((r) => r), [gid]);
  useAppChrome({ title: invite.data?.title, role: 'Invitation' });
  const existing = useMemo(() => loadCredentials('member', gid), [gid]);
  const hostCreds = useMemo(() => loadCredentials('admin', gid), [gid]);

  if (invite.loading) {
    return (
      <PageContainer narrow>
        <h1 className="sr-only">Loading invitation</h1>
        <SkeletonLines lines={5} />
      </PageContainer>
    );
  }
  if (invite.error) {
    const notFound = (invite.error as ApiError).status === 404;
    return (
      <PageContainer narrow>
        <h1>{notFound ? 'We can’t find this invitation' : 'We couldn’t load this invitation'}</h1>
        <Notice tone={notFound ? 'warn' : 'danger'}>
          <p>{notFound ? 'The link may be incomplete, or the exchange may have been deleted or expired.' : invite.error.message}</p>
        </Notice>
        <div className="btn-row">
          {!notFound && <Button onClick={invite.reload}>Try again</Button>}
          <LinkButton to="/">Go home</LinkButton>
        </div>
      </PageContainer>
    );
  }
  const inv = invite.data!;

  return (
    <PageContainer narrow>
      {hostCreds && (
        <Notice tone="info" title="You’re the host of this exchange">
          <p>
            This is the page your group sees. <Link to={`/g/${gid}/admin`}>Go to your admin page</Link>. If you’re playing too, you can still join below.
          </p>
        </Notice>
      )}
      {existing?.memberId ? (
        <AlreadyJoined gid={gid} creds={existing} title={inv.title} />
      ) : (
        <Wizard gid={gid} invite={inv} />
      )}
    </PageContainer>
  );
}

function AlreadyJoined({ gid, creds, title }: { gid: string; creds: StoredCredentials; title: string }) {
  return (
    <>
      <h1>You’re already in</h1>
      <p className="lede">This device has your private link for “{title}”.</p>
      <div className="btn-row">
        <LinkButton to={`/g/${gid}/m/${creds.memberId}`} variant="primary" size="large">
          Open my page
        </LinkButton>
      </div>
      <p className="muted" style={{ marginTop: 'var(--space-5)' }}>
        Not you? Someone else may have used this device. Open your page and choose &ldquo;Forget this device,&rdquo; then reload this invitation.
      </p>
    </>
  );
}

type Invite = Awaited<ReturnType<typeof api.invite>>;

function Wizard({ gid, invite }: { gid: string; invite: Invite }) {
  const navigate = useNavigate();
  const draft = useMemo(() => loadDraft<Draft>(`join:${gid}`), [gid]);
  const [step, setStep] = useState(-1); // -1 = invitation overview
  const [name, setName] = useState(draft?.name ?? '');
  const [wishlist, setWishlist] = useState(draft?.wishlist ?? '');
  const [wallet, setWallet] = useState<Draft['wallet']>(draft?.wallet);
  // The address is deliberately NOT restored from the draft: it is never written to browser storage.
  const [address, setAddress] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<PublicConfig>();
  const [human, setHuman] = useState<HumanCheckState>({ required: false, ticket: null, ready: false });
  const [humanKey, setHumanKey] = useState(0);
  const [joined, setJoined] = useState<StoredCredentials>();
  // The host's invite link carries the host's public key after the #. If the server later served a different key
  // (for example a tampered one), joining would seal everything to someone else: compare them.
  const readLinkKey = () => /(?:^#|&)hk=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash)?.[1];
  const [linkKey, setLinkKey] = useState(readLinkKey);
  useEffect(() => {
    const onHash = () => setLinkKey(readLinkKey());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const hostKeyState: 'match' | 'mismatch' | 'absent' = !linkKey ? 'absent' : linkKey === invite.hostPublicKey ? 'match' : 'mismatch';

  useEffect(() => {
    saveDraft(`join:${gid}`, { name, wishlist, wallet } satisfies Draft);
  }, [gid, name, wishlist, wallet]);
  useEffect(() => {
    api.config().then(setConfig, () => undefined);
  }, []);

  const result: GiftAddressResult | undefined = useMemo(() => (address.length > 0 ? validateGiftAddress(address.trim()) : undefined), [address]);
  const err = (id: string) => errors.find((e) => e.id === id)?.message;
  const go = (n: number) => {
    setErrors([]);
    setStep(n);
  };

  if (joined) {
    return <Done gid={gid} creds={joined} title={invite.title} onContinue={() => navigate(`/g/${gid}/m/${joined.memberId}`)} />;
  }

  if (!invite.joinOpen) {
    const reason =
      invite.spotsLeft === 0 && invite.state === 'open'
        ? 'This exchange is full.'
        : invite.state === 'open'
          ? 'The deadline for joining has passed.'
          : invite.state === 'locked'
            ? 'The host has closed joining.'
            : 'The names have already been drawn, so no one else can join.';
    return (
      <>
        <h1>{invite.title}</h1>
        <Notice tone="warn" title="This exchange isn’t accepting new people">
          <p>{reason} Ask the host if you think this is a mistake.</p>
        </Notice>
        <Notice tone="info">
          <p>
            Already joined on another device? <Link to="/recover">Restore your link</Link>.
          </p>
        </Notice>
      </>
    );
  }

  const validateStep = (s: number): boolean => {
    const out: { id: string; message: string }[] = [];
    if (s === 0) {
      const n = [...name.trim()].length;
      if (n < LIMITS.pseudonymMin) out.push({ id: 'j-name', message: `Choose a nickname of at least ${LIMITS.pseudonymMin} characters.` });
      if (n > LIMITS.pseudonymMax) out.push({ id: 'j-name', message: `Keep your nickname to ${LIMITS.pseudonymMax} characters or fewer.` });
      if ([...wishlist.trim()].length > LIMITS.wishlistMax) out.push({ id: 'j-wish', message: `Keep your wishlist to ${LIMITS.wishlistMax} characters or fewer.` });
    }
    if (s === 1 && !wallet) out.push({ id: 'j-wallet', message: 'Choose the option that fits you best.' });
    if (s === 2) {
      if (!address.trim()) out.push({ id: 'j-address', message: 'Paste your shielded receiving address.' });
      else if (result && !result.ok) out.push({ id: 'j-address', message: result.message });
    }
    if (s === 3) {
      if (hostKeyState === 'mismatch') out.push({ id: 'j-consent', message: 'This invitation does not match the host’s key. Do not join.' });
      if (!consent) out.push({ id: 'j-consent', message: 'Please confirm you understand who can see your details.' });
      if (human.required && !human.ready) out.push({ id: 'j-human', message: 'Complete the human check first.' });
    }
    setErrors(out);
    return out.length === 0;
  };

  const submit = async () => {
    if (!validateStep(3)) return;
    setBusy(true);
    setFormError('');
    try {
      const c = await loadCrypto();
      if (!result || !result.ok) throw new Error('Your address needs attention before you can join.');
      // One key pair and token per join attempt: a retry after an interruption maps to the same membership.
      let keys = loadDraft<KeyDraft>(`join-keys:${gid}`);
      if (!keys) {
        const kp = await c.generateKeyPair();
        keys = { secretKey: c.encodeKey(kp.secretKey), token: c.generateToken() };
        saveDraft(`join-keys:${gid}`, keys);
      }
      const pub = c.encodeKey(c.publicKeyFromSecret(c.decodeKey(keys.secretKey)));
      const sealedProfile = c.sealProfile({ v: 1, kind: 'profile', groupId: gid, pseudonym: name.trim().normalize('NFC'), wishlist: wishlist.trim(), address: result.address }, invite.hostPublicKey);
      const res = await api.join(gid, {
        pseudonym: name.trim(),
        publicKey: pub,
        tokenHash: c.hashToken(keys.token),
        sealedProfile,
        // Fingerprint of the address as registered: whoever draws me can't swap in a different one without it showing.
        addressCommitment: c.addressCommitment(gid, name.trim().normalize('NFC'), result.address),
        ...(human.ticket ? { humanTicket: human.ticket } : {}),
      });
      const creds: StoredCredentials = { v: 1, role: 'member', groupId: gid, memberId: res.memberId, secretKey: keys.secretKey, token: keys.token };
      saveCredentials(creds);
      clearDraft(`join-keys:${gid}`);
      clearDraft(`join:${gid}`);
      setJoined(creds);
    } catch (e) {
      const ae = e as ApiError;
      if (ae.code === 'human_check_failed') setHumanKey((k) => k + 1);
      if (ae.code === 'duplicate_pseudonym') {
        setStep(0);
        setErrors([{ id: 'j-name', message: ae.message }]);
      } else {
        setFormError(ae.message || 'Something went wrong. Please try again.');
      }
      setBusy(false);
    }
  };

  /* ----- Step -1: the invitation ----- */
  if (step === -1) {
    return (
      <>
        <p className="eyebrow">You&rsquo;re invited</p>
        <h1>{invite.title}</h1>
        <dl className="facts">
          <div className="fact"><dt>Gift budget</dt><dd>about {formatUsd(invite.budgetCents)}</dd></div>
          <div className="fact"><dt>Join by</dt><dd>{formatCalendarDate(invite.joinDeadline, { weekday: 'short', day: 'numeric', month: 'short' })} <span className="muted">({untilLabel(invite.joinClosesAt)})</span></dd></div>
          <div className="fact"><dt>Reveal</dt><dd>{formatCalendarDate(invite.revealDate, { weekday: 'short', day: 'numeric', month: 'short' })}</dd></div>
          <div className="fact"><dt>Spots left</dt><dd>{plural(invite.spotsLeft, 'spot')}</dd></div>
        </dl>
        <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--fs-4)' }}>How this works</h2>
          <ol>
            <li>You choose a nickname, a wishlist and a shielded Zcash address.</li>
            <li>The host draws names. Only you can open your assignment.</li>
            <li>You send one gift from your own wallet. Someone sends you one.</li>
          </ol>
          <p>You&rsquo;ll need a Zcash wallet with a shielded address. If you don&rsquo;t have one yet, the next steps help.</p>
        </div>
        {hostKeyState === 'mismatch' && (
          <Notice tone="danger" title="Don’t join: this invitation doesn’t match the host’s key" live="assertive">
            <p>The link you opened says one thing about the host’s key and Mummer’s server says another. That can mean the link was altered or the server was tampered with. Ask the host for a fresh invite link, ideally in person or over a channel you trust.</p>
          </Notice>
        )}
        {hostKeyState === 'absent' && (
          <Notice tone="info" title="This link has no host key to check">
            <p>The host’s own invite link includes a fingerprint of their key, which lets your browser confirm the server hasn’t swapped it. This copy doesn’t include it. You can still join, but if you can, ask the host for the full link.</p>
          </Notice>
        )}
        <Notice tone="warn" title="What the host can see">
          <p>Your nickname, wishlist and address, because the host&rsquo;s browser runs the draw. The host&rsquo;s browser could also see who draws whom. Mummer&rsquo;s server cannot read your details or the pairings.</p>
        </Notice>
        <div className="btn-row">
          <Button variant="primary" size="large" onClick={() => go(0)} disabled={hostKeyState === 'mismatch'}>
            Join this exchange
          </Button>
          <Link to="/privacy" className="btn btn--ghost" target="_blank" rel="noopener noreferrer">
            Read the privacy details<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 'var(--space-5)' }}>
          Already joined? <Link to="/recover">Restore your link</Link>.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">Join {invite.title}</h1>
      <p className="eyebrow">{invite.title}</p>
      <Steps labels={STEPS} current={step} />
      <ErrorSummary errors={errors} />
      {formError && (
        <Notice tone="danger" title="We couldn’t complete your join" live="assertive">
          <p>{formError}</p>
        </Notice>
      )}

      {step === 0 && (
        <section aria-labelledby="s0">
          <h2 id="s0" style={{ fontSize: 'var(--fs-5)' }}>Who are you in this exchange?</h2>
          <TextField id="j-name" label="Your nickname" hint="Everyone in the group sees this. A pseudonym is fine." value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" error={err('j-name')} counter={{ value: [...name.trim()].length, max: LIMITS.pseudonymMax }} />
          <TextAreaField id="j-wish" label="Wishlist (optional)" hint="Ideas for your giver. They’ll see this, and so will the host." value={wishlist} onChange={(e) => setWishlist(e.target.value)} rows={4} error={err('j-wish')} counter={{ value: [...wishlist.trim()].length, max: LIMITS.wishlistMax }} />
          <div className="form-actions">
            <Button variant="ghost" onClick={() => go(-1)}>Back</Button>
            <div className="btn-row">
              <Button variant="primary" onClick={() => validateStep(0) && go(1)}>Next: your wallet</Button>
            </div>
          </div>
        </section>
      )}

      {step === 1 && (
        <section aria-labelledby="s1">
          <h2 id="s1" style={{ fontSize: 'var(--fs-5)' }}>Do you have a Zcash wallet?</h2>
          <p>Gifts arrive in your own wallet, at a shielded address you control. Mummer never holds them.</p>
          <div id="j-wallet" tabIndex={-1}>
            <ChoiceGroup
              legend="Where are you with this?"
              name="wallet"
              value={wallet}
              onChange={setWallet}
              options={[
                { value: 'have', label: 'I have a wallet and know my shielded address' },
                { value: 'find', label: 'I have a wallet but I’m not sure where to find my address' },
                { value: 'none', label: 'I don’t have a wallet yet' },
              ]}
            />
            {err('j-wallet') && <p className="error" role="alert">{err('j-wallet')}</p>}
          </div>
          {wallet && wallet !== 'have' && (
            <Notice tone="info" title={wallet === 'none' ? 'Set one up first' : 'Here’s where to look'}>
              <p>
                {wallet === 'none' ? 'Install a wallet, back up its secret words on paper, and get a few dollars of ZEC.' : 'In your wallet, open Receive and copy the address it shows. It should start with u1 or zs1.'} The{' '}
                <a href="/wallet-guide" target="_blank" rel="noopener noreferrer">wallet guide<span className="sr-only"> (opens in a new tab)</span></a> walks through it. Your answers here are saved in this tab, so you can come back.
              </p>
            </Notice>
          )}
          <Notice tone="danger" title="Never enter your secret words here">
            <p>Mummer only ever needs your receiving address, never your wallet&rsquo;s secret recovery words or a viewing key.</p>
          </Notice>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => go(0)}>Back</Button>
            <div className="btn-row">
              <Button variant="primary" onClick={() => validateStep(1) && go(2)}>Next: your address</Button>
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="s2">
          <h2 id="s2" style={{ fontSize: 'var(--fs-5)' }}>Paste your shielded address</h2>
          <TextAreaField id="j-address" label="Your shielded receiving address" hint="Use a fresh address from your wallet’s Receive screen, so it isn’t tied to anything else you do." value={address} onChange={(e) => setAddress(e.target.value.trim())} rows={4} className="mono" spellCheck={false} autoComplete="off" autoCapitalize="off" error={undefined} aria-describedby="addr-status" />
          <div className="address-check" id="addr-status" aria-live="polite">
            {result?.ok && (
              <Notice tone="success" title="This looks like a valid shielded address">
                <p>
                  It ends in <code>{addressTail(result.address)}</code>. Check that matches the address in your wallet.
                </p>
                {result.warnings.includes('contains_transparent_receiver') && (
                  <p>
                    <strong>Heads up:</strong> this address also contains a transparent (public) part. Wallets should still pay the shielded part, but for the best privacy use a shielded-only address if your wallet offers one.
                  </p>
                )}
                {result.warnings.includes('has_expiry_height') && <p>This address has an expiry. Make sure it will still be valid when gifts are sent.</p>}
              </Notice>
            )}
            {result && !result.ok && (
              <Notice tone="danger" title="We can’t use this address" live="polite">
                <p>{result.message}</p>
                {(result.code === 'transparent' || result.code === 'tex' || result.code === 'unknown_format') && (
                  <p>
                    In your wallet&rsquo;s Receive screen, choose the shielded address. <a href="/wallet-guide" target="_blank" rel="noopener noreferrer">See the guide<span className="sr-only"> (opens in a new tab)</span></a>.
                  </p>
                )}
              </Notice>
            )}
          </div>
          {err('j-address') && !result && <p className="error" role="alert">{err('j-address')}</p>}
          <div className="form-actions">
            <Button variant="ghost" onClick={() => go(1)}>Back</Button>
            <div className="btn-row">
              <Button variant="primary" onClick={() => validateStep(2) && go(3)} disabled={!result?.ok}>Next: review</Button>
            </div>
          </div>
        </section>
      )}

      {step === 3 && result?.ok && (
        <section aria-labelledby="s3">
          <h2 id="s3" style={{ fontSize: 'var(--fs-5)' }}>Review and join</h2>
          <dl className="facts">
            <div className="fact"><dt>Nickname</dt><dd>{name.trim()}</dd></div>
            <div className="fact"><dt>Address</dt><dd className="mono">{addressTail(result.address, 8)}</dd></div>
            <div className="fact"><dt>Wishlist</dt><dd style={{ whiteSpace: 'pre-wrap', fontWeight: 400 }}>{wishlist.trim() || 'None'}</dd></div>
          </dl>
          <Notice tone="warn" title="Who sees what">
            <p>
              The <strong>host</strong> sees your nickname, wishlist and address. Whoever draws you (your <strong>giver</strong>) sees your wishlist and address. Everyone else sees your nickname. Mummer&rsquo;s server stores your wishlist and address only sealed.
            </p>
          </Notice>
          <div id="j-consent" tabIndex={-1}>
            <CheckField checked={consent} onChange={setConsent} id="j-consent-box" error={err('j-consent')}>
              I understand who can see my details, and I&rsquo;ll save the private link I&rsquo;m given next.
            </CheckField>
          </div>
          <div id="j-human" tabIndex={-1}>
            <HumanCheck key={humanKey} config={config} onChange={setHuman} />
            {err('j-human') && <p className="error" role="alert">{err('j-human')}</p>}
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => go(2)}>Back</Button>
            <div className="btn-row">
              <Button variant="primary" size="large" loading={busy} onClick={submit}>
                Join {invite.title}
              </Button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function Done({ gid, creds, title, onContinue }: { gid: string; creds: StoredCredentials; title: string; onContinue: () => void }) {
  const [saved, setSaved] = useState(isLinkSaved('member', gid));
  return (
    <>
      <div className="screen-title">
        <Seal size="4.5rem" stamp />
        <h1>You&rsquo;re in</h1>
      </div>
      <p className="lede">You&rsquo;ve joined &ldquo;{title}&rdquo;. One last thing: save your private link so you can get back to your assignment.</p>
      {!saved ? (
        <LinkSaver creds={creds} kind="member" title={title} onSaved={() => setSaved(true)} />
      ) : (
        <Notice tone="success" title="Link saved">
          <p>Thanks. You&rsquo;re all set.</p>
        </Notice>
      )}
      {saved && (
        <div className="btn-row" style={{ marginTop: 'var(--space-5)' }}>
          <Button variant="primary" size="large" onClick={onContinue}>
            Go to my page
          </Button>
        </div>
      )}
    </>
  );
}
