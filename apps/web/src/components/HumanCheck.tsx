import { useEffect, useRef, useState } from 'react';
import { api, type PublicConfig } from '../lib/api';

/**
 * Human check (Cloudflare Turnstile) in an isolated, sandboxed iframe with an
 * opaque origin: Cloudflare's script never shares an origin with this app, so
 * it cannot read private-link fragments, keys or storage. The token it returns
 * is exchanged for a single-use ticket that group creation / joining consume.
 */

export interface HumanCheckState {
  /** True when the server requires a ticket. */
  required: boolean;
  /** Ticket to send with the request, once obtained. */
  ticket: string | null;
  ready: boolean;
}

export function HumanCheck({ config, onChange }: { config: PublicConfig | undefined; onChange: (s: HumanCheckState) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'verifying' | 'passed' | 'failed' | 'unavailable'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!config) return;
    if (!config.humanCheckRequired) {
      onChange({ required: false, ticket: null, ready: true });
      setStatus('passed');
      return;
    }
    if (!config.turnstileSiteKey) {
      onChange({ required: true, ticket: null, ready: false });
      setStatus('unavailable');
      return;
    }
    onChange({ required: true, ticket: null, ready: false });
    setStatus('waiting');
    const handler = async (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { source?: string; type?: string; token?: string; reason?: string };
      if (data?.source !== 'mummer-human-check') return;
      if (data.type === 'token' && typeof data.token === 'string') {
        setStatus('verifying');
        try {
          const r = await api.humanVerify(data.token);
          onChange({ required: true, ticket: r.ticket, ready: !!r.ticket });
          setStatus(r.ticket ? 'passed' : 'failed');
        } catch (err) {
          setStatus('failed');
          setMessage((err as Error).message);
          onChange({ required: true, ticket: null, ready: false });
        }
      } else if (data.type === 'expired') {
        setStatus('waiting');
        onChange({ required: true, ticket: null, ready: false });
      } else if (data.type === 'error') {
        setStatus('failed');
        setMessage(data.reason === 'script-blocked' ? 'The human check could not load. Disable any blockers for this page and reload.' : 'The human check hit a problem. Reload the page and try again.');
        onChange({ required: true, ticket: null, ready: false });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (!config || !config.humanCheckRequired) return null;
  return (
    <div className="field">
      <span className="label" style={{ fontFamily: 'var(--font-ui)', fontWeight: 650, fontSize: 'var(--fs-1)' }}>
        Quick human check
      </span>
      <p className="hint">This keeps bots from creating junk exchanges. Cloudflare runs the check, in a sandboxed frame that cannot see anything you type here.</p>
      {config.turnstileSiteKey && status !== 'passed' && (
        <iframe
          ref={frame}
          className="humancheck"
          title="Human check"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={`/human-check?sitekey=${encodeURIComponent(config.turnstileSiteKey)}`}
        />
      )}
      <p role="status" aria-live="polite" className={status === 'passed' ? 'yes' : status === 'failed' || status === 'unavailable' ? 'no' : 'muted'} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
        {status === 'passed' && 'Check passed.'}
        {status === 'verifying' && 'Verifying…'}
        {status === 'failed' && (message || 'The human check did not pass. Please try again.')}
        {status === 'unavailable' && 'Mummer can’t start new exchanges or accept new joins right now. Please try again later.'}
      </p>
    </div>
  );
}
