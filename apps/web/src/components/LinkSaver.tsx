import { useEffect, useId, useState } from 'react';
import { downloadTextFile } from '../lib/browser';
import { loadCrypto } from '../lib/cryptoClient';
import { markLinkSaved, type StoredCredentials } from '../lib/session';
import { Button, CopyButton, Disclosure, Notice, TextField, TextAreaField } from './ui';

/**
 * "Save your private link" gate. The link carries the person's key and token in
 * its fragment. We ask them to copy or download it, then to paste it back so we
 * know it was really saved before they continue (a lost admin link cannot be
 * recovered, and neither can a member key).
 */
export function LinkSaver({
  creds,
  kind,
  title,
  onSaved,
  embedded = false,
}: {
  creds: StoredCredentials;
  kind: 'admin' | 'member';
  title: string;
  onSaved: () => void;
  /** Used inside another section (e.g. account settings): no landmark of its own, lower heading level. */
  embedded?: boolean;
}) {
  const uid = useId();
  const boxId = `${uid}-link`;
  const [link, setLink] = useState<string>('');
  const [shown, setShown] = useState(false);
  const [paste, setPaste] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [backup, setBackup] = useState<{ pass: string; text: string; error: string; busy: boolean }>({ pass: '', text: '', error: '', busy: false });

  useEffect(() => {
    loadCrypto().then((c) => {
      const path = kind === 'admin' ? c.adminPath(creds.groupId) : c.memberPath(creds.groupId, creds.memberId!);
      setLink(`${window.location.origin}${path}${c.buildFragment({ secretKey: c.decodeKey(creds.secretKey), token: creds.token })}`);
    });
  }, [creds, kind]);

  const label = kind === 'admin' ? 'admin link' : 'private link';

  const download = () => {
    downloadTextFile(
      `mummer-${kind}-link.txt`,
      `MUMMER ${label.toUpperCase()}\n${title}\n\nAnyone with this link can act as you in this exchange. Keep it private.\nMummer cannot recover it if it is lost.\n\n${link}\n`,
    );
  };

  const verify = async () => {
    setVerifyError('');
    const c = await loadCrypto();
    let url: URL;
    try {
      url = new URL(paste.trim());
    } catch {
      setVerifyError('That doesn’t look like a link. Paste the whole thing, starting with https://');
      return;
    }
    const expectedPath = kind === 'admin' ? c.adminPath(creds.groupId) : c.memberPath(creds.groupId, creds.memberId!);
    const parsed = c.parseFragment(url.hash);
    if (url.pathname !== expectedPath || !parsed) {
      setVerifyError('That link is for something else, or it’s missing the part after the #. Copy it again from the box above.');
      return;
    }
    if (c.encodeKey(parsed.secretKey) !== creds.secretKey || parsed.token !== creds.token) {
      setVerifyError('That link doesn’t match this one. Copy it again from the box above.');
      return;
    }
    markLinkSaved(kind, creds.groupId);
    onSaved();
  };

  const makeBackup = async () => {
    setBackup((b) => ({ ...b, error: '', busy: true }));
    try {
      const c = await loadCrypto();
      c.checkPassphrase(backup.pass);
      // argon2id is deliberately slow (about a second); yield so the button state paints first.
      await new Promise((r) => setTimeout(r, 30));
      const text = c.sealBackup(
        { v: 1, kind: 'mummer-backup', role: kind, groupId: creds.groupId, ...(creds.memberId ? { memberId: creds.memberId } : {}), secretKey: creds.secretKey, token: creds.token },
        backup.pass,
      );
      setBackup((b) => ({ ...b, text, busy: false }));
    } catch (e) {
      const weak = (e as { code?: string }).code === 'weak_passphrase';
      setBackup((b) => ({ ...b, busy: false, error: weak ? 'Use at least 10 characters. A few random words is best.' : 'We couldn’t create the backup. Please try again.' }));
    }
  };

  return (
    <Wrapper className={embedded ? 'card card--flat' : 'card'} labelledBy={embedded ? undefined : `${uid}-title`}>
      {embedded ? (
        <h4 id={`${uid}-title`}>Copy or back up your {label}</h4>
      ) : (
        <h2 id={`${uid}-title`} style={{ fontSize: 'var(--fs-4)' }}>
          Save your {label}
        </h2>
      )}
      <Notice tone="warn" title="This link is your key">
        <p>
          Anyone with it can {kind === 'admin' ? 'run this exchange' : 'open your assignment'} as you. Mummer can&rsquo;t recover it if it&rsquo;s lost, because the key it contains was made in this browser and never sent to us.
        </p>
      </Notice>

      <div className="field">
        <label htmlFor={boxId}>Your {label}</label>
        <p className="hint">Hidden by default so it doesn&rsquo;t end up in a screenshot. Copy it to a password manager, or download it.</p>
        <div className="copyfield">
          <input id={boxId} className="input mono" type={shown ? 'text' : 'password'} readOnly value={link} aria-describedby={`${boxId}-hint`} autoComplete="off" spellCheck={false} />
          <Button size="small" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
            {shown ? 'Hide' : 'Show'}
          </Button>
        </div>
        <span id={`${boxId}-hint`} className="sr-only">
          This field contains a secret link.
        </span>
      </div>
      <div className="btn-row" style={{ marginBottom: 'var(--space-5)' }}>
        <CopyButton text={link} label="Copy link" describe={label} size="normal" />
        <Button onClick={download} disabled={!link}>
          Download as a file
        </Button>
      </div>

      <Disclosure summary="Optional: make a passphrase-protected backup">
        <p>A backup is your safety net if you lose the link but remember a passphrase. It&rsquo;s encrypted in your browser. If you forget the passphrase, the backup is useless.</p>
        <TextField label="Passphrase" type="password" autoComplete="new-password" value={backup.pass} onChange={(e) => setBackup((b) => ({ ...b, pass: e.target.value, text: '' }))} hint="At least 10 characters. A few unrelated words works well." error={backup.error} />
        <Button onClick={makeBackup} loading={backup.busy} disabled={backup.pass.length === 0}>
          Create backup
        </Button>
        {backup.text && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p className="hint">Store this text somewhere safe. You&rsquo;ll need the passphrase to use it.</p>
            <pre className="codebox" tabIndex={0}>{backup.text}</pre>
            <div className="btn-row">
              <CopyButton text={backup.text} label="Copy backup" describe="backup" size="normal" />
              <Button onClick={() => downloadTextFile(`mummer-${kind}-backup.txt`, `${backup.text}\n`)}>Download backup</Button>
            </div>
          </div>
        )}
      </Disclosure>

      <hr />
      <h3 style={{ fontSize: 'var(--fs-3)' }}>Check that you saved it</h3>
      <p>Paste your link below. This proves it works before you carry on.</p>
      <TextAreaField label="Paste your link" value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} className="mono" spellCheck={false} autoComplete="off" error={verifyError} />
      <Button variant="primary" onClick={verify} disabled={paste.trim().length === 0}>
        Confirm I saved it
      </Button>
    </Wrapper>
  );
}

function Wrapper({ className, labelledBy, children }: { className: string; labelledBy?: string; children: React.ReactNode }) {
  return labelledBy ? (
    <section className={className} aria-labelledby={labelledBy}>
      {children}
    </section>
  ) : (
    <div className={className}>{children}</div>
  );
}
