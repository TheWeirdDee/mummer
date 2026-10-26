import { PageContainer } from '../components/Layout';
import { Notice } from '../components/ui';
import { usePageMeta } from '../lib/hooks';

type Status = 'tested' | 'not-verified' | 'not-built';

const STATUS_LABEL: Record<Status, { text: string; cls: string }> = {
  tested: { text: 'Tested in automated checks', cls: 'yes' },
  'not-verified': { text: 'Not yet verified', cls: 'no' },
  'not-built': { text: 'Not built', cls: 'no' },
};

const CLAIMS: { claim: string; status: Status; evidence: string }[] = [
  { claim: 'The server stores no plain-text wallet addresses, wishlists or pairings.', status: 'tested', evidence: 'Tests run a full exchange, then scan every database row and every request and response for those values.' },
  { claim: 'Each person can open only their own assignment.', status: 'tested', evidence: 'An endpoint-by-role authorization matrix, cross-member and cross-group checks, and cryptographic wrong-key tests.' },
  { claim: 'The draw is a single cycle: nobody draws themselves, and exclusions are honored.', status: 'tested', evidence: '100,000 seeded draws with a statistical uniformity test, plus exclusion, impossibility and size tests.' },
  { claim: 'Addresses are checked by Zcash’s own rules (ZIP 316).', status: 'tested', evidence: 'Decoded against the official Zcash test vectors; transparent, test-network, typo and truncated addresses are refused with a reason.' },
  { claim: 'Payment requests follow the ZIP 321 standard.', status: 'tested', evidence: 'Built and re-parsed against the standard’s own valid and invalid examples; memos are limited by bytes, amounts use exact integers.' },
  { claim: 'Only one draw can ever be saved, even with simultaneous requests.', status: 'tested', evidence: 'Concurrent-draw tests against a real database.' },
  { claim: 'A duplicate confirmation never counts twice.', status: 'tested', evidence: 'Concurrent duplicate-confirmation tests against the public counter.' },
  { claim: 'Zodl on iOS and Android reads Mummer’s payment request, including the memo and amount.', status: 'not-verified', evidence: 'Needs real devices and a real send. Until then the app always offers copy buttons for each part.' },
  { claim: 'A real group has completed an exchange with real ZEC.', status: 'not-verified', evidence: 'Requires consenting participants spending real funds. No such trial is claimed.' },
  { claim: 'Proof that a gift was actually paid.', status: 'not-built', evidence: 'Shielded payments can’t be checked by Mummer. Confirmations are the recipient’s own report.' },
  { claim: 'A draw the host can’t see.', status: 'not-built', evidence: 'Needs a reviewed multi-party protocol. The host-run draw is clearly disclosed instead.' },
  { claim: 'Company-funded gifts.', status: 'not-built', evidence: 'The wallet we use rejects multi-recipient requests, and funding needs its own privacy review.' },
  { claim: 'An independent security review.', status: 'not-verified', evidence: 'None has been done. The test suite is not a substitute for one.' },
];

const SCHEMA: { table: string; holds: string; sealed: string }[] = [
  { table: 'groups', holds: 'Name, budget, dates, timezone, host public key, state, hashed admin token', sealed: 'Nothing secret' },
  { table: 'members', holds: 'Nickname, member public key, hashed token, sender note, join day', sealed: 'Profile (wishlist + address) sealed to the host key' },
  { table: 'assignments', holds: 'Giver id, draw version', sealed: 'The assignment, sealed to the giver’s key' },
  { table: 'ack_commitments', holds: 'Recipient id, state, one-way fingerprint of a gift reference', sealed: 'The reference itself is not stored' },
  { table: 'reveals', holds: 'A giver and recipient pair, only after the giver consented and proved it', sealed: 'n/a (consented, by design)' },
  { table: 'audit_events', holds: 'Group-level events with the day only', sealed: 'No addresses, memos, IPs or per-person post-draw actions' },
  { table: 'stats, rate_limits, human_tickets', holds: 'Aggregate counters; salted hashed request buckets; single-use check tickets', sealed: 'No group or person identifiers' },
];

export function Evidence() {
  usePageMeta('Evidence and limits | Mummer', 'What Mummer has tested, what it has not yet verified, what it does not do, and exactly what its database holds.');
  return (
    <PageContainer>
      <div className="page-head">
        <p className="eyebrow">Evidence and limits</p>
        <h1>What we&rsquo;ve checked, and what we haven&rsquo;t</h1>
        <p className="lede">A privacy tool is only as honest as its claims. This page separates what automated tests prove, what still needs real-world verification, and what Mummer doesn&rsquo;t do.</p>
      </div>

      <section aria-labelledby="claims-title">
        <h2 id="claims-title" style={{ fontSize: 'var(--fs-4)' }}>Claims and their status</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Claims and evidence, scroll horizontally on small screens">
          <table className="table">
            <caption className="sr-only">Each claim, whether it has been verified, and the evidence</caption>
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Status</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {CLAIMS.map((c) => (
                <tr key={c.claim}>
                  <th scope="row">{c.claim}</th>
                  <td>
                    <span className={STATUS_LABEL[c.status].cls}>{STATUS_LABEL[c.status].text}</span>
                  </td>
                  <td>{c.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="stored-title" style={{ paddingBottom: 0 }}>
        <h2 id="stored-title" style={{ fontSize: 'var(--fs-4)' }}>What the database holds</h2>
        <p className="measure">Every table, and what is readable by the server versus sealed. Hosts can open a live, redacted view of the rows for their own exchange from their admin page.</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Database tables, scroll horizontally on small screens">
          <table className="table">
            <caption className="sr-only">Database tables and their contents</caption>
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Holds</th>
                <th scope="col">Sealed or never stored</th>
              </tr>
            </thead>
            <tbody>
              {SCHEMA.map((s) => (
                <tr key={s.table}>
                  <th scope="row">
                    <code>{s.table}</code>
                  </th>
                  <td>{s.holds}</td>
                  <td>{s.sealed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="limits-title" style={{ paddingBottom: 0 }}>
        <h2 id="limits-title" style={{ fontSize: 'var(--fs-4)' }}>Known limits</h2>
        <div className="grid-2">
          <Notice tone="warn" title="Trust in the website itself">
            <p>Like any web app, Mummer could in principle serve you altered code. Strict content rules and the absence of third-party scripts on pages that hold secrets reduce the risk; they don&rsquo;t remove the need to trust whoever runs the site.</p>
          </Notice>
          <Notice tone="warn" title="Address substitution">
            <p>Because sealing is anonymous, someone who controls the server could in principle swap one person&rsquo;s address for another. Always check the address in your wallet, and ask recipients to confirm their gift arrived.</p>
          </Notice>
        </div>
      </section>
    </PageContainer>
  );
}
