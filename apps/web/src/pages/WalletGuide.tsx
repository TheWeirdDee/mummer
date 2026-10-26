import { PageContainer } from '../components/Layout';
import { Notice, LinkButton } from '../components/ui';
import { usePageMeta } from '../lib/hooks';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function WalletGuide() {
  usePageMeta('Wallet guide: get set up for a shielded gift | Mummer', 'A beginner-friendly guide to installing a Zcash wallet, getting a little ZEC, finding a shielded receiving address, sending a gift and reading a memo.');
  return (
    <PageContainer narrow>
      <div className="page-head">
        <p className="eyebrow">Wallet guide</p>
        <h1>Get ready to give (and receive) a shielded gift</h1>
        <p className="lede">New to Zcash? This takes about ten minutes. We use the Zodl wallet in examples; the ideas apply to any wallet that supports shielded addresses.</p>
      </div>

      <Notice tone="danger" title="Never type your secret words into Mummer">
        <p>
          Your wallet&rsquo;s secret recovery words are the wallet. Anyone who has them can take everything in it. Mummer will <strong>never</strong> ask for them, nor for a viewing key. If any website, message or &ldquo;support agent&rdquo; asks, it&rsquo;s a scam.
        </p>
      </Notice>

      <div className="stack-lg">
        <section className="guide-step" aria-labelledby="g1">
          <span className="guide-step__n" aria-hidden="true">1</span>
          <div className="copy-tight">
            <h2 id="g1" style={{ fontSize: 'var(--fs-4)' }}>Install a wallet</h2>
            <p>
              Install <strong>Zodl</strong> from your phone&rsquo;s official app store. It&rsquo;s a Zcash wallet that supports shielded addresses and shielded memos. See the{' '}
              <a href="https://z.cash/ecosystem/zodl-wallet/" {...ext}>Zcash page about Zodl<span className="sr-only"> (opens in a new tab)</span></a>.
            </p>
            <p className="muted">Mummer isn&rsquo;t affiliated with Zodl. Screens and labels change between versions, so yours may look a little different.</p>
          </div>
        </section>

        <section className="guide-step" aria-labelledby="g2">
          <span className="guide-step__n" aria-hidden="true">2</span>
          <div className="copy-tight">
            <h2 id="g2" style={{ fontSize: 'var(--fs-4)' }}>Back up your secret words, inside the wallet</h2>
            <p>The wallet will show you a list of recovery words. Write them on paper, somewhere safe and offline. They are the only way to get your wallet back if you lose your phone.</p>
            <ul>
              <li>Don&rsquo;t screenshot them, email them, or save them in a notes app.</li>
              <li>Don&rsquo;t share them with anyone, ever. Not with us, not with &ldquo;support.&rdquo;</li>
            </ul>
          </div>
        </section>

        <section className="guide-step" aria-labelledby="g3">
          <span className="guide-step__n" aria-hidden="true">3</span>
          <div className="copy-tight">
            <h2 id="g3" style={{ fontSize: 'var(--fs-4)' }}>Get a little ZEC</h2>
            <p>Gift budgets are small, so you only need a few dollars&rsquo; worth plus a tiny network fee. Common ways to get some:</p>
            <ul>
              <li>
                <strong>Buy on an exchange</strong> that lists ZEC, then withdraw it to your wallet&rsquo;s <em>shielded</em> address from step 4. Exchanges often need ID checks, which can take a day.
              </li>
              <li>
                <strong>Swap inside the wallet.</strong> Zodl has a swap feature that can convert other coins into ZEC. Availability and supported coins vary by region and version.
              </li>
              <li>
                <strong>Ask a friend</strong> who already uses Zcash to send you a few dollars&rsquo; worth to your shielded address.
              </li>
            </ul>
            <p className="muted">Prices move. The amount Mummer quotes is approximate and expires after ten minutes.</p>
          </div>
        </section>

        <section className="guide-step" aria-labelledby="g4">
          <span className="guide-step__n" aria-hidden="true">4</span>
          <div className="copy-tight">
            <h2 id="g4" style={{ fontSize: 'var(--fs-4)' }}>Find your shielded receiving address</h2>
            <p>
              In the wallet, open <strong>Receive</strong>. Copy the address it shows. A shielded address usually starts with <code>u1</code> (a &ldquo;unified&rdquo; address) or <code>zs1</code> (an older shielded style). Zodl&rsquo;s changelog says it shows a shielded-only
              unified address and makes a fresh one each time you open Receive.
            </p>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Which addresses Mummer accepts">
              <table className="table">
                <caption className="sr-only">Address types and whether Mummer accepts them</caption>
                <thead>
                  <tr>
                    <th scope="col">Starts with</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Mummer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row"><code>u1</code>, <code>zu1</code></th>
                    <td>Unified, with a shielded part</td>
                    <td><span className="yes">Accepted</span></td>
                  </tr>
                  <tr>
                    <th scope="row"><code>zs1</code></th>
                    <td>Sapling shielded</td>
                    <td><span className="yes">Accepted</span></td>
                  </tr>
                  <tr>
                    <th scope="row"><code>t1</code>, <code>t3</code>, <code>tex1</code></th>
                    <td>Transparent (public)</td>
                    <td><span className="no">Refused: payments would be public</span></td>
                  </tr>
                  <tr>
                    <th scope="row"><code>utest1</code>, <code>ztestsapling1</code></th>
                    <td>Test network</td>
                    <td><span className="no">Refused: Mummer uses the main network</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 'var(--space-4)' }}>Use a fresh address for each exchange so it isn&rsquo;t linked to anything else you do.</p>
          </div>
        </section>

        <section className="guide-step" aria-labelledby="g5">
          <span className="guide-step__n" aria-hidden="true">5</span>
          <div className="copy-tight">
            <h2 id="g5" style={{ fontSize: 'var(--fs-4)' }}>Sending a gift</h2>
            <p>When it&rsquo;s time to give, Mummer shows a QR code and the same details as text. In your wallet, scan the QR or paste the details. Then check three things <strong>before</strong> you approve:</p>
            <ol>
              <li>
                <strong>Address.</strong> It should match the one Mummer shows. Check the first and last few characters.
              </li>
              <li>
                <strong>Amount.</strong> It should match the ZEC amount on the screen, and the quote should not have expired.
              </li>
              <li>
                <strong>Memo.</strong> It should start with <code>MUMMER</code> and a reference like <code>MUM-XXXX-…</code>.
              </li>
            </ol>
            <Notice tone="warn" title="Scanning might not fill everything in">
              <p>Wallets differ in how they read payment requests, and we haven&rsquo;t yet recorded a device test of every wallet and version. If the amount or memo is missing after you scan, type or paste them from the copy buttons. Never send if the address looks wrong.</p>
            </Notice>
          </div>
        </section>

        <section className="guide-step" aria-labelledby="g6">
          <span className="guide-step__n" aria-hidden="true">6</span>
          <div className="copy-tight">
            <h2 id="g6" style={{ fontSize: 'var(--fs-4)' }}>Reading a memo you received</h2>
            <p>
              A memo is a short message attached to a shielded payment. Only the recipient&rsquo;s wallet can read it. In Zodl, open the payment in your Activity list and tap it to see the memo (
              <a href="https://support.zodl.com/article/41-using-the-zcash-memo-field" {...ext}>Zodl&rsquo;s memo article<span className="sr-only"> (opens in a new tab)</span></a>). Copy the reference that starts with <code>MUM-</code> if you want to enter it in Mummer when you confirm.
            </p>
          </div>
        </section>

        <section className="guide-step" aria-labelledby="g7">
          <span className="guide-step__n" aria-hidden="true">7</span>
          <div className="copy-tight">
            <h2 id="g7" style={{ fontSize: 'var(--fs-4)' }}>What stays visible, and why recovery matters</h2>
            <ul>
              <li>A shielded payment hides sender, recipient and amount on the public ledger. The fact that a payment happened, and when, is still visible.</li>
              <li>Moving money from a transparent address into a shielded one is visible. That&rsquo;s normal when you first fund the wallet.</li>
              <li>If you lose your phone and your written words, your funds are gone for good. Nobody, including us, can restore them.</li>
            </ul>
          </div>
        </section>
      </div>

      <div className="section" style={{ paddingBottom: 0 }}>
        <div className="card card--tint">
          <h2 style={{ fontSize: 'var(--fs-4)' }}>Ready?</h2>
          <p>With a wallet and a shielded address, you&rsquo;re set to host or join.</p>
          <div className="btn-row">
            <LinkButton to="/new" variant="primary">Start an exchange</LinkButton>
            <LinkButton to="/how-it-works">How it works</LinkButton>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
