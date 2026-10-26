import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageContainer } from '../components/Layout';
import { Button, Disclosure, Notice, TextAreaField, TextField } from '../components/ui';
import { readFileAsText } from '../lib/browser';
import { loadCrypto } from '../lib/cryptoClient';
import { usePageMeta } from '../lib/hooks';
import { listSavedGroups, markLinkSaved, saveCredentials, type StoredCredentials } from '../lib/session';

export function Recover() {
  usePageMeta('Lost a link? Recovery options | Mummer', 'Restore your Mummer access from a passphrase-protected backup or a saved private link, and learn what can and cannot be recovered.', { index: false });
  const navigate = useNavigate();
  const saved = useMemo(() => listSavedGroups(), []);
  const [backup, setBackup] = useState('');
  const [pass, setPass] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = (creds: StoredCredentials) => {
    saveCredentials(creds);
    markLinkSaved(creds.role, creds.groupId);
    navigate(creds.role === 'admin' ? `/g/${creds.groupId}/admin` : `/g/${creds.groupId}/m/${creds.memberId}`);
  };

  const restoreBackup = async () => {
    setError('');
    setBusy(true);
    try {
      const c = await loadCrypto();
      // argon2id is deliberately slow; let the button state paint first.
      await new Promise((r) => setTimeout(r, 30));
      const b = c.openBackup(backup.trim(), pass);
      finish({ v: 1, role: b.role, groupId: b.groupId, ...(b.memberId ? { memberId: b.memberId } : {}), secretKey: b.secretKey, token: b.token });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === 'decrypt_failed' ? 'That passphrase doesn’t open this backup, or the backup text was changed. Check both and try again.' : code === 'bad_backup' ? 'That doesn’t look like a Mummer backup. Paste the whole text, starting with MUMBK1.' : 'We couldn’t restore that backup.');
      setBusy(false);
    }
  };

  const restoreLink = async () => {
    setError('');
    try {
      const c = await loadCrypto();
      const url = new URL(link.trim());
      const parsed = c.parseFragment(url.hash);
      const m = /^\/g\/([0-9a-f]{32})\/(admin|m\/([0-9a-f]{32}))$/.exec(url.pathname);
      if (!parsed || !m) throw new Error('bad');
      finish({ v: 1, role: m[2] === 'admin' ? 'admin' : 'member', groupId: m[1]!, ...(m[3] ? { memberId: m[3] } : {}), secretKey: c.encodeKey(parsed.secretKey), token: parsed.token });
    } catch {
      setError('That isn’t a complete private link. It should start with https:// and include a long part after the # sign.');
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await readFileAsText(f);
      const m = /MUMBK1\.[A-Za-z0-9_-]+/.exec(text);
      setBackup(m ? m[0] : text.trim());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <PageContainer narrow>
      <div className="page-head">
        <p className="eyebrow">Recovery</p>
        <h1>Lost a link?</h1>
        <p className="lede">Mummer has no accounts, so it can&rsquo;t email you a reset. Your access is the private link, or a backup you made. Here&rsquo;s what can and can&rsquo;t be done.</p>
      </div>

      {saved.length > 0 && (
        <section className="card" style={{ marginBottom: 'var(--space-5)' }} aria-labelledby="saved-title">
          <h2 id="saved-title" style={{ fontSize: 'var(--fs-4)' }}>Saved on this device</h2>
          <ul>
            {saved.map((s) => (
              <li key={`${s.role}${s.groupId}`}>
                <Link to={s.role === 'admin' ? `/g/${s.groupId}/admin` : `/g/${s.groupId}/m/${s.memberId}`}>{s.role === 'admin' ? 'Host page' : 'Participant page'} (exchange {s.groupId.slice(0, 6)}…)</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <Notice tone="danger" title="That didn’t work" live="assertive">
          <p>{error}</p>
        </Notice>
      )}

      <div className="stack">
        <section className="card" aria-labelledby="bk-title">
          <h2 id="bk-title" style={{ fontSize: 'var(--fs-4)' }}>Restore from a passphrase backup</h2>
          <TextAreaField label="Backup text" hint="Starts with MUMBK1. You can also load the file you downloaded." value={backup} onChange={(e) => setBackup(e.target.value)} rows={3} className="mono" spellCheck={false} autoComplete="off" />
          <div className="field">
            <label htmlFor="bk-file">Or choose the backup file</label>
            <input id="bk-file" type="file" accept=".txt,text/plain" className="input" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <TextField label="Passphrase" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          <Button variant="primary" onClick={restoreBackup} loading={busy} disabled={!backup.trim() || !pass}>
            Restore access
          </Button>
        </section>

        <section className="card" aria-labelledby="lk-title">
          <h2 id="lk-title" style={{ fontSize: 'var(--fs-4)' }}>Restore from a saved link</h2>
          <p>If you have the private link but opening it didn&rsquo;t work (for example, it was cut off in a message), paste the whole thing here.</p>
          <TextAreaField label="Private link" value={link} onChange={(e) => setLink(e.target.value)} rows={3} className="mono" spellCheck={false} autoComplete="off" />
          <Button onClick={restoreLink} disabled={!link.trim()}>
            Use this link
          </Button>
        </section>

        <Disclosure summary="I have neither a link nor a backup">
          <div className="prose">
            <h3>If you&rsquo;re the host</h3>
            <p>Mummer can&rsquo;t read your people&rsquo;s details without your key, so a lost admin link means this exchange can&rsquo;t be run any more. Start a new one and invite people again. No money was ever held, so nothing is lost but time.</p>
            <h3>If you&rsquo;re a participant, before the draw</h3>
            <p>Open the invite link and join again with a new link. Ask the host to remove your old entry so your name is free.</p>
            <h3>If you&rsquo;re a participant, after the draw</h3>
            <p>Your assignment is sealed to a key that only existed in your browser, so nobody can reopen it for you, including the host. Tell the host: they can flag the exchange for the group to sort out, or redraw if nobody has sent yet.</p>
          </div>
        </Disclosure>

        <Notice tone="info" title="Never share your link or backup">
          <p>Anyone with your private link can act as you in that exchange. A backup is protected by your passphrase, but treat it carefully too.</p>
        </Notice>
      </div>
    </PageContainer>
  );
}
