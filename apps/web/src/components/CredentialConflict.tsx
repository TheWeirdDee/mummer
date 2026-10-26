import { Button, Notice } from './ui';

/**
 * Shown when a private link's key differs from the key this device already saved for the same exchange.
 * Silently overwriting would let a crafted or stale link destroy the only copy of someone's key, so the person decides.
 */
export function CredentialConflict({ what, onChoose }: { what: 'admin' | 'member'; onChoose: (useLink: boolean) => void }) {
  return (
    <>
      <h1>This link is different from the one saved here</h1>
      <Notice tone="warn" title="Which one do you want?">
        <p>
          This device already has a {what === 'admin' ? 'host' : 'private'} key saved for this exchange, and the link you just opened carries a different one. That happens if you replaced your link on another device. It can also happen if someone sent you a link they made, and
          using it would replace your saved key (which might be your only copy).
        </p>
      </Notice>
      <div className="btn-row">
        <Button variant="primary" onClick={() => onChoose(false)}>
          Keep the key saved on this device
        </Button>
        <Button onClick={() => onChoose(true)}>Use this link and replace the saved key</Button>
      </div>
      <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
        Not sure? Keep the saved key. You can always open the other link again later.
      </p>
    </>
  );
}
