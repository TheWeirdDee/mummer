import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LIMITS, addDays, daysBetween, isValidTimezone, todayIn } from '@mummer/shared';
import { HumanCheck, type HumanCheckState } from '../components/HumanCheck';
import { PageContainer } from '../components/Layout';
import { Button, CheckField, ChoiceGroup, ErrorSummary, Notice, SelectField, TextField } from '../components/ui';
import { api, ApiError, type PublicConfig } from '../lib/api';
import { deviceTimeZone, timeZoneOptions } from '../lib/browser';
import { loadCrypto } from '../lib/cryptoClient';
import { formatUsd } from '../lib/format';
import { usePageMeta } from '../lib/hooks';
import { clearPendingCreate, loadPendingCreate, savePendingCreate } from '../lib/session';

const PRESETS = [500, 1000, 2500, 5000] as const;

/** Parse "12", "12.5", "12.50" into integer cents without floating point. */
function parseDollars(s: string): number | undefined {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

export function CreateGroup() {
  usePageMeta('Start a Mummer exchange', 'Create a Secret Santa exchange with private shielded gifts. Set a budget and dates, then share one invite link.', { index: false });
  const navigate = useNavigate();
  const tz0 = useMemo(() => (isValidTimezone(deviceTimeZone()) ? deviceTimeZone() : 'UTC'), []);
  const zones = useMemo(() => timeZoneOptions(), []);
  const today0 = todayIn(tz0, new Date());

  const [title, setTitle] = useState('');
  const [preset, setPreset] = useState<number | 'custom'>(2500);
  const [custom, setCustom] = useState('');
  const [joinDeadline, setJoinDeadline] = useState(addDays(today0, 10));
  const [revealDate, setRevealDate] = useState(addDays(today0, 17));
  const [timezone, setTimezone] = useState(tz0);
  const [memberCap, setMemberCap] = useState('20');
  const [hostPlays, setHostPlays] = useState<'yes' | 'no' | undefined>(undefined);
  const [trust, setTrust] = useState(false);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [formError, setFormError] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<PublicConfig>();
  const [human, setHuman] = useState<HumanCheckState>({ required: false, ticket: null, ready: false });
  const [humanKey, setHumanKey] = useState(0);

  useEffect(() => {
    api.config().then(setConfig, () => setFormError('We couldn’t reach Mummer. Check your connection and reload the page.'));
  }, []);

  const err = (id: string) => errors.find((e) => e.id === id)?.message;

  const validate = () => {
    const out: { id: string; message: string }[] = [];
    const t = title.trim();
    if ([...t].length < LIMITS.titleMin) out.push({ id: 'f-title', message: `Give the exchange a name of at least ${LIMITS.titleMin} characters.` });
    if ([...t].length > LIMITS.titleMax) out.push({ id: 'f-title', message: `Keep the name to ${LIMITS.titleMax} characters or fewer.` });
    const cents = preset === 'custom' ? parseDollars(custom) : preset;
    if (cents === undefined) out.push({ id: 'f-budget', message: 'Enter the budget as dollars, like 20 or 12.50.' });
    else if (cents < LIMITS.budgetMinCents || cents > LIMITS.budgetMaxCents) out.push({ id: 'f-budget', message: `Budgets run from ${formatUsd(LIMITS.budgetMinCents)} to ${formatUsd(LIMITS.budgetMaxCents)}.` });
    const today = todayIn(timezone, new Date());
    if (joinDeadline < today) out.push({ id: 'f-join', message: 'The join deadline can’t be in the past.' });
    else if (daysBetween(today, joinDeadline) > LIMITS.joinDeadlineMaxDays) out.push({ id: 'f-join', message: `Pick a join deadline within ${LIMITS.joinDeadlineMaxDays} days.` });
    if (revealDate && joinDeadline && daysBetween(joinDeadline, revealDate) < LIMITS.revealMinGapDays) out.push({ id: 'f-reveal', message: 'The reveal date must be at least a day after the join deadline.' });
    else if (daysBetween(today, revealDate) > LIMITS.revealMaxDays) out.push({ id: 'f-reveal', message: `Pick a reveal date within ${LIMITS.revealMaxDays} days.` });
    const cap = Number(memberCap);
    if (!Number.isInteger(cap) || cap < LIMITS.memberCapMin || cap > LIMITS.memberCapMax) out.push({ id: 'f-cap', message: `Choose a limit between ${LIMITS.memberCapMin} and ${LIMITS.memberCapMax} people.` });
    if (!hostPlays) out.push({ id: 'f-host', message: 'Tell us whether you’ll take part yourself.' });
    if (!trust) out.push({ id: 'f-trust', message: 'Please confirm you understand how the draw works.' });
    if (human.required && !human.ready) out.push({ id: 'f-human', message: 'Complete the human check first.' });
    return out;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const found = validate();
    setErrors(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const c = await loadCrypto();
      // One key pair and token per form session: a repeated submission after an interruption maps to the same group.
      let pending = loadPendingCreate();
      if (!pending) {
        const kp = await c.generateKeyPair();
        pending = { secretKey: c.encodeKey(kp.secretKey), token: c.generateToken() };
        savePendingCreate(pending);
      }
      const publicKey = c.encodeKey(c.publicKeyFromSecret(c.decodeKey(pending.secretKey)));
      const cents = preset === 'custom' ? parseDollars(custom)! : preset;
      const res = await api.createGroup({
        title: title.trim(),
        budgetCents: cents,
        joinDeadline,
        revealDate,
        timezone,
        memberCap: Number(memberCap),
        hostPlays: hostPlays === 'yes',
        hostPublicKey: publicKey,
        adminTokenHash: c.hashToken(pending.token),
        ...(human.ticket ? { humanTicket: human.ticket } : {}),
      });
      const fragment = c.buildFragment({ secretKey: c.decodeKey(pending.secretKey), token: pending.token });
      clearPendingCreate();
      // The fragment carries the admin credentials to the next page, which saves them on this device and removes them from the address bar.
      navigate(`/g/${res.groupId}/admin${fragment}`, { replace: true });
    } catch (e2) {
      const ae = e2 as ApiError;
      if (ae.code === 'human_check_failed') setHumanKey((k) => k + 1);
      setFormError(ae.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const cents = preset === 'custom' ? parseDollars(custom) : preset;

  return (
    <PageContainer narrow>
      <div className="screen-title">
        <h1>Start an exchange</h1>
      </div>
      <p className="lede" style={{ marginBottom: 'var(--space-6)' }}>
        About two minutes. You&rsquo;ll get an invite link to share and an admin link to keep.
      </p>

      <form onSubmit={onSubmit} noValidate className="form-card">
        <ErrorSummary errors={errors} />
        {formError && (
          <Notice tone="danger" title="We couldn’t create the exchange" live="assertive">
            <p>{formError}</p>
          </Notice>
        )}

        <TextField id="f-title" label="Name of the exchange" hint="Everyone in the group will see this, for example “Office Santa 2026”." value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax * 2} autoComplete="off" error={err('f-title')} counter={{ value: [...title.trim()].length, max: LIMITS.titleMax }} />

        <fieldset className="fieldset" aria-describedby="budget-hint">
          <legend>Gift budget (US dollars)</legend>
          <p className="hint" id="budget-hint" style={{ marginTop: 0 }}>
            Each giver sends about this much, converted to ZEC at a recent price. Small budgets work well; the cap is {formatUsd(LIMITS.budgetMaxCents)}.
          </p>
          <div className="chip-group" role="group" aria-label="Budget presets">
            {PRESETS.map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={preset === p} onClick={() => setPreset(p)}>
                {formatUsd(p)}
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
              Other
            </button>
          </div>
          {preset === 'custom' && (
            <div style={{ marginTop: 'var(--space-3)', maxWidth: '12rem' }}>
              <TextField id="f-budget" label="Budget in dollars" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. 20" error={err('f-budget')} />
            </div>
          )}
          {preset !== 'custom' && err('f-budget') && <p className="error" role="alert">{err('f-budget')}</p>}
        </fieldset>

        <div className="grid-2">
          <TextField id="f-join" type="date" label="People can join until" hint="The deadline day is included." value={joinDeadline} onChange={(e) => setJoinDeadline(e.target.value)} error={err('f-join')} />
          <TextField id="f-reveal" type="date" label="Reveal date" hint="When givers may choose to unmask." value={revealDate} onChange={(e) => setRevealDate(e.target.value)} error={err('f-reveal')} />
        </div>

        <SelectField id="f-tz" label="Timezone" hint="Deadlines and the reveal begin at midnight in this timezone, so everyone sees the same moment." value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {zones.includes(timezone) ? null : <option value={timezone}>{timezone}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </SelectField>

        <TextField id="f-cap" type="number" inputMode="numeric" min={LIMITS.memberCapMin} max={LIMITS.memberCapMax} label="Most people allowed" hint={`${LIMITS.memberCapMin} is the minimum to draw. ${LIMITS.recommendedMembers} or more is better: in a group of four, each person can work out more about who gave to whom.`} value={memberCap} onChange={(e) => setMemberCap(e.target.value)} error={err('f-cap')} style={{ maxWidth: '8rem' }} />

        <div id="f-host" tabIndex={-1}>
          <ChoiceGroup
            legend="Will you take part yourself?"
            hint="You&rsquo;ll run the draw either way."
            name="hostPlays"
            value={hostPlays}
            onChange={setHostPlays}
            options={[
              { value: 'no', label: 'No, I’m only organizing', detail: 'Recommended if you want the pairings kept away from anyone who is playing.' },
              { value: 'yes', label: 'Yes, I’m playing too', detail: 'You’ll join with the invite link like everyone else, after you create the exchange.' },
            ]}
          />
          {err('f-host') && <p className="error" role="alert" style={{ marginTop: '-1rem', marginBottom: '1.5rem' }}>{err('f-host')}</p>}
        </div>

        <Notice tone="warn" title="How the draw works, and what the host can see">
          <p>
            The draw runs in <strong>your browser</strong>. To do it, your browser opens everyone&rsquo;s nickname, wishlist and wallet address, so you could see who draws whom. Mummer&rsquo;s server never sees the pairings.{' '}
            <Link to="/privacy">Who can see what</Link>
          </p>
        </Notice>
        <CheckField id="f-trust" checked={trust} onChange={setTrust} error={err('f-trust')}>
          I understand that the draw runs in my browser, so I could see who draws whom.
        </CheckField>

        <div id="f-human" tabIndex={-1}>
          <HumanCheck key={humanKey} config={config} onChange={setHuman} />
          {err('f-human') && <p className="error" role="alert">{err('f-human')}</p>}
        </div>

        {cents !== undefined && (
          <p className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
            Summary: {title.trim() || 'Your exchange'}, {formatUsd(cents)} gifts, joining closes {joinDeadline}, reveal {revealDate} ({timezone.replace(/_/g, ' ')}).
          </p>
        )}

        <div className="form-actions">
          <Link to="/" className="btn btn--ghost">
            Cancel
          </Link>
          <div className="btn-row">
            <Button type="submit" variant="primary" size="large" loading={busy}>
              Create the exchange
            </Button>
          </div>
        </div>
      </form>
    </PageContainer>
  );
}
