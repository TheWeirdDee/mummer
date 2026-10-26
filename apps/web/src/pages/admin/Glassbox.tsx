import { useState } from 'react';
import { Button, Notice } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

/** A live, redacted view of every row the server holds for this exchange. Sealed values show as sizes and fingerprints only. */
export function Glassbox({ gid, token }: { gid: string; token: string }) {
  const [data, setData] = useState<Record<string, unknown>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await api.glassbox(gid, token));
    } catch (e) {
      setError((e as ApiError).message);
    }
    setBusy(false);
  };

  return (
    <div>
      <p>
        See exactly what Mummer&rsquo;s server holds for this exchange. Wishlists, addresses and assignments appear only as sealed blobs: a length and a short fingerprint, never the content.
      </p>
      {!data && (
        <Button onClick={load} loading={busy}>
          Show what&rsquo;s stored
        </Button>
      )}
      {error && (
        <Notice tone="danger">
          <p>{error}</p>
        </Notice>
      )}
      {data && (
        <>
          <div className="btn-row" style={{ marginBottom: 'var(--space-3)' }}>
            <Button onClick={load} loading={busy}>
              Refresh
            </Button>
            <Button variant="ghost" onClick={() => setData(undefined)}>
              Hide
            </Button>
          </div>
          <pre className="codebox" tabIndex={0} aria-label="Redacted database contents" style={{ maxHeight: '24rem', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
