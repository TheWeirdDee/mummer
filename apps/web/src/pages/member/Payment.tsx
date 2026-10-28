import { useEffect, useMemo, useState } from 'react';
import { NOTE_MAX_BYTES, buildGiftMemo, buildPaymentRequest, formatZec, usdCentsToZat, utf8Length, validateGiftAddress, verifyPaymentRequest, type MemoError } from '@mummer/zcash';
import type { BundlePlain, RosterEntry } from '@mummer/shared';
import { addressCommitment } from '@mummer/crypto/light';
import { QR } from '../../components/QR';
import { Button, CopyButton, CopyField, Dialog, Notice, Spinner, TextAreaField } from '../../components/ui';
import { api, ApiError, type PriceQuote } from '../../lib/api';
import { addressPreview, formatUsd } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import type { StoredCredentials } from '../../lib/session';

/**
 * The payment request for this member's gift. Safety rules enforced here:
 *  - the address is re-validated in this browser before anything is shown;
 *  - the amount is exact integer arithmetic from a quoted price that expires;
 *  - the URI is re-parsed and compared field-for-field before the QR is drawn;
 *  - "sent" is only ever a self-report, never shown as payment success.
 */
const sourceName = (host: string) => (host.includes('coingecko') ? 'CoinGecko' : host);

export function Payment({
  gid,
  mid,
  creds,
  bundle,
  drawVersion,
  alreadyReportedSent,
  closed,
  roster,
  groupBudgetCents,
  onReported,
}: {
  gid: string;
  mid: string;
  creds: StoredCredentials;
  bundle: BundlePlain;
  drawVersion: number;
  alreadyReportedSent: boolean;
  closed: boolean;
  /** The group's public roster: each person's nickname and the fingerprint of the address they registered. */
  roster: RosterEntry[];
  /** The budget the group was created with (public), to compare with what the assignment says. */
  groupBudgetCents: number;
  onReported: () => void;
}) {
  const [price, setPrice] = useState<PriceQuote>();
  const [priceError, setPriceError] = useState('');
  const [loadingPrice, setLoadingPrice] = useState(true);
  const [note, setNote] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = useNow(1000);

  const fetchPrice = async () => {
    setLoadingPrice(true);
    setPriceError('');
    try {
      setPrice(await api.price());
    } catch (e) {
      setPrice(undefined);
      setPriceError((e as ApiError).message);
    }
    setLoadingPrice(false);
  };
  useEffect(() => {
    void fetchPrice();
  }, []);

  const address = useMemo(() => validateGiftAddress(bundle.recipient.address), [bundle.recipient.address]);

  // The host authors assignments, so before any payment request is shown, check the assignment against what the
  // server publishes and the recipient's own browser registered: their address fingerprint, nickname and the budget.
  const integrity = useMemo(() => {
    const entry = roster.find((r) => r.id === bundle.recipient.memberId);
    if (!entry) return 'The person you are giving to is no longer listed in this exchange.';
    if (entry.status === 'revoked') return `${entry.pseudonym} has left or been removed from this exchange, so please don’t send this gift. The host will sort it out with the group.`;
    if (entry.pseudonym !== bundle.recipient.pseudonym) return 'The name in your assignment doesn’t match the group list.';
    if (!entry.addressCommitment || addressCommitment(gid, entry.pseudonym, bundle.recipient.address) !== entry.addressCommitment) {
      return `The address in your assignment isn’t the one ${entry.pseudonym} registered.`;
    }
    if (bundle.budgetCents !== groupBudgetCents) return 'The amount in your assignment doesn’t match the budget the group agreed.';
    return undefined;
  }, [roster, bundle, gid, groupBudgetCents]);
  // Someone who left or was removed is an ordinary, supported event; only the other mismatches can mean an altered assignment.
  const membershipOnly = useMemo(() => {
    const entry = roster.find((r) => r.id === bundle.recipient.memberId);
    return !entry || entry.status === 'revoked';
  }, [roster, bundle]);
  const expired = price ? now.getTime() >= Date.parse(price.validUntil) : false;
  const secondsLeft = price ? Math.max(0, Math.round((Date.parse(price.validUntil) - now.getTime()) / 1000)) : 0;

  const built = useMemo(() => {
    if (!address.ok || !price || expired) return undefined;
    try {
      const amountZat = usdCentsToZat(bundle.budgetCents, price.usdPerZec);
      const memo = buildGiftMemo({ reference: bundle.reference, note });
      const uri = buildPaymentRequest({ address: address.address, amountZat, memo, label: 'Mummer gift' });
      // Never display a request that doesn't re-parse to exactly the intended address, amount and memo.
      verifyPaymentRequest(uri, { address: address.address, amountZat, memo });
      return { amountZat, memo, uri, error: undefined as string | undefined };
    } catch (e) {
      return { amountZat: 0n, memo: '', uri: '', error: (e as MemoError).message || 'The payment request could not be built.' };
    }
  }, [address, price, expired, bundle.budgetCents, bundle.reference, note]);

  const noteBytes = utf8Length(note.trim());
  const fallbackMemo = useMemo(() => {
    try {
      return buildGiftMemo({ reference: bundle.reference, note });
    } catch {
      return '';
    }
  }, [bundle.reference, note]);

  const report = async () => {
    setBusy(true);
    setError('');
    try {
      await api.sent(gid, mid, creds.token, drawVersion);
      setConfirmSent(false);
      onReported();
    } catch (e) {
      setError((e as ApiError).message);
    }
    setBusy(false);
  };

  if (closed) {
    return (
      <Notice tone="info" title="This exchange is closed">
        <p>Payments can no longer be recorded here.</p>
      </Notice>
    );
  }

  if (integrity) {
    return (
      <Notice tone="danger" title="Don’t send anything yet" live="assertive">
        <p>{integrity} {membershipOnly ? 'Tell the host before anyone sends, so it can be sorted out.' : 'That shouldn’t happen. It can mean the assignment was altered. Tell the group (and the host) before anyone sends, so it can be sorted out.'}</p>
      </Notice>
    );
  }

  if (!address.ok) {
    return (
      <Notice tone="danger" title="We can’t build a payment for this address">
        <p>
          The address your recipient registered didn&rsquo;t pass our checks: {address.message} Please <strong>don&rsquo;t send anything</strong>. Tell the host. If nobody has reported sending yet, they can reset the draw so {bundle.recipient.pseudonym} can rejoin with a valid address; otherwise the group needs to arrange it another way.
        </p>
      </Notice>
    );
  }

  return (
    <div className="stack">
      {alreadyReportedSent && (
        <Notice tone="warn" title="You already marked this gift as sent">
          <p>
            Only send again if you&rsquo;re sure the first payment didn&rsquo;t go through. Check your wallet&rsquo;s activity first, because a second payment can&rsquo;t be taken back.
          </p>
        </Notice>
      )}

      <div>
        <p className="eyebrow">Quote</p>
        {loadingPrice && (
          <p>
            <Spinner label="Getting a current price" /> Getting a current price…
          </p>
        )}
        {priceError && (
          <Notice tone="danger" title="We couldn’t get a price right now" live="polite">
            <p>{priceError}</p>
            <Button onClick={fetchPrice}>Try again</Button>
          </Notice>
        )}
        {price && built && !built.error && (
          <>
            <p style={{ fontSize: 'var(--fs-4)', fontFamily: 'var(--font-ui)', fontWeight: 650, marginBottom: 'var(--space-2)' }}>
              {formatZec(built.amountZat)} ZEC <span className="muted" style={{ fontWeight: 400 }}>≈ {formatUsd(bundle.budgetCents)}</span>
            </p>
            <p className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
              At ${Number(price.usdPerZec).toLocaleString('en-US', { maximumFractionDigits: 2 })} per ZEC from {sourceName(price.source)}, as of {new Date(price.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Approximate: the price moves. This quote is good for {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, '0')} more.
            </p>
          </>
        )}
        {price && expired && (
          <Notice tone="warn" title="This quote has expired" live="polite">
            <p>Prices move, so the request below is hidden until you refresh the quote.</p>
            <Button variant="primary" onClick={fetchPrice} loading={loadingPrice}>
              Get a fresh quote
            </Button>
          </Notice>
        )}
        {(priceError || expired) && !loadingPrice && (
          <div className="card card--tint card--flat" style={{ marginTop: 'var(--space-4)' }}>
            <h3 style={{ fontSize: 'var(--fs-3)' }}>You can still send without a quote</h3>
            <p>
              Without a current price Mummer can&rsquo;t work out the amount. Your gift is about {formatUsd(bundle.budgetCents)}: ask your wallet for that amount in ZEC at its own price, and use the details below. Or try again in a minute.
            </p>
            <CopyField label="Address" value={address.address} describe="address" />
            {fallbackMemo && <CopyField label="Memo" value={fallbackMemo} describe="memo" />}
          </div>
        )}
        {built?.error && (
          <Notice tone="danger" title="We can’t build the request" live="polite">
            <p>{built.error}</p>
          </Notice>
        )}
      </div>

      <TextAreaField
        label="Add a note (optional)"
        hint="It goes in the payment memo, and your recipient reads it in their wallet. A personal note can help them guess who you are."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        counter={{ value: noteBytes, max: NOTE_MAX_BYTES }}
        error={noteBytes > NOTE_MAX_BYTES ? 'That note is too long for a memo. Shorten it: emoji and accented letters take extra room.' : undefined}
      />

      {built && !built.error && (
        <div className="pay-grid">
          <div>
            <QR value={built.uri} label={`Payment request for ${formatZec(built.amountZat)} ZEC to ${addressPreview(address.address)}`} />
            <p className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-0)', marginTop: 'var(--space-2)', maxWidth: '20rem' }}>
              Scan with your wallet&rsquo;s scanner, then check the details before approving.
            </p>
          </div>
          <div>
            <div className="btn-row" style={{ marginBottom: 'var(--space-4)' }}>
              <a className="btn btn--primary" href={built.uri}>
                Open in my wallet
              </a>
              <CopyButton text={built.uri} label="Copy request link" describe="payment request link" size="normal" />
            </div>
            <p className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
              If nothing opens, or your wallet doesn&rsquo;t fill everything in, use the copy buttons below.
            </p>
          </div>
        </div>
      )}

      {built && !built.error && (
        <div className="stack">
          <CopyField label="Address" value={address.address} hint={`Starts ${address.address.slice(0, 8)}…, ends …${address.address.slice(-8)}. Compare these with what your wallet shows. If you aren’t sure the address is right, ask ${bundle.recipient.pseudonym} to check the end of the address they saw when they joined.`} describe="address" />
          <CopyField label="Amount (ZEC)" value={formatZec(built.amountZat)} describe="amount" />
          <div className="field">
            <label htmlFor="memo-box">Memo</label>
            <p className="hint">Keep the reference at the start. It&rsquo;s how your recipient can match this gift.</p>
            <div className="copyfield">
              <textarea id="memo-box" className="textarea mono" readOnly rows={Math.min(6, 2 + Math.ceil(built.memo.length / 40))} value={built.memo} style={{ minHeight: '4.5rem' }} />
              <CopyButton text={built.memo} describe="memo" />
            </div>
          </div>
        </div>
      )}

      <section className="card card--tint card--flat" aria-labelledby="check-title">
        <h3 id="check-title" style={{ fontSize: 'var(--fs-3)' }}>Before you approve in your wallet</h3>
        <ul className="checklist">
          <li><span>The address matches the one above (check the first and last characters). If in doubt, ask the recipient to check theirs.</span></li>
          <li><span>The amount matches, and it&rsquo;s a <strong>shielded</strong> payment.</span></li>
          <li><span>The memo starts with <code>MUMMER</code> and the reference.</span></li>
          <li><span>You&rsquo;re on the main Zcash network, not a test network.</span></li>
        </ul>
        <p className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)', marginBottom: 0 }}>
          Mummer can&rsquo;t send anything for you. Your wallet signs and sends. If a wallet shows something different from this page, don&rsquo;t send.
        </p>
      </section>

      {error && (
        <Notice tone="danger" live="assertive">
          <p>{error}</p>
        </Notice>
      )}
      {!alreadyReportedSent && (
        <div>
          <Button variant="secondary" onClick={() => setConfirmSent(true)}>
            I sent it
          </Button>
          <p className="hint" style={{ fontFamily: 'var(--font-ui)', marginTop: 'var(--space-2)' }}>
            Only tap this after your wallet shows the payment as sent. It adds to the group&rsquo;s count, but it&rsquo;s just your note.
          </p>
        </div>
      )}

      <Dialog
        open={confirmSent}
        onClose={() => setConfirmSent(false)}
        title="Mark your gift as sent?"
        actions={
          <>
            <Button onClick={() => setConfirmSent(false)}>Not yet</Button>
            <Button variant="primary" onClick={report} loading={busy}>
              Yes, I sent it
            </Button>
          </>
        }
      >
        <p>
          This tells the group&rsquo;s counter that you sent your gift. Mummer can&rsquo;t see your payment, so it&rsquo;s only your word. You can&rsquo;t undo it, and it doesn&rsquo;t tell anyone who you gave to.
        </p>
      </Dialog>
    </div>
  );
}
