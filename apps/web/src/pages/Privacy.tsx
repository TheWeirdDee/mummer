import { Link } from 'react-router-dom';
import { PageContainer } from '../components/Layout';
import { Notice, ResponsiveTable } from '../components/ui';
import { usePageMeta } from '../lib/hooks';

export function Privacy() {
  usePageMeta('Privacy: who can see what | Mummer', 'Exactly what Mummer, your host, your giver, hosting providers and the public ledger can and cannot see. Honest limits included.');
  return (
    <PageContainer>
      <div className="page-head">
        <p className="eyebrow">Privacy</p>
        <h1>Who can see what</h1>
        <p className="lede">Mummer helps keep gift payments shielded on Zcash, while limiting what the organizer app stores. It does not make anyone invisible. Here is the full picture, including the parts that aren&rsquo;t flattering.</p>
      </div>

      <Notice tone="warn" title="The host's browser runs the draw">
        <p>
          In this version the draw happens in the host&rsquo;s browser, so a host who wants to can see every pairing. Mummer&rsquo;s server never learns them from the draw. The one exception is a reveal that a giver chooses to make: then the server stores that one pair, as described in the table below. If that matters to your group, choose a host who isn&rsquo;t taking part. A draw that even the host can&rsquo;t see needs a reviewed cryptographic protocol that
          we haven&rsquo;t built, so we don&rsquo;t claim it.
        </p>
      </Notice>

      <ResponsiveTable label="Who can see what, scroll horizontally on small screens" caption="What each party can and cannot learn">
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Can see</th>
              <th scope="col">Can&rsquo;t see through Mummer</th>
              <th scope="col">Still possible</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Anyone reading the Zcash ledger</th>
              <td>That a shielded payment happened, its time and its fee.</td>
              <td>Sender, recipient, amount, memo.</td>
              <td>Guessing from timing, such as many payments on reveal day.</td>
            </tr>
            <tr>
              <th scope="row">Mummer&rsquo;s server and database</th>
              <td>Group name, nicknames, budget, dates, counts, and sealed data it can&rsquo;t open. Stored times are whole days, except the exchange&rsquo;s own deadline and expiry instants and the short-lived rate-limit records.</td>
              <td>Wallet addresses, wishlists, memos, keys, and who drew whom (except a pair a giver chooses to reveal).</td>
              <td>Your IP address and request timing, like any website. A malicious operator could serve altered code.</td>
            </tr>
            <tr>
              <th scope="row">Hosting and network providers</th>
              <td>That your device connected, when, and how much data moved.</td>
              <td>The contents of your assignment.</td>
              <td>Platform logs we don&rsquo;t control. Hashing an address doesn&rsquo;t hide it from the network edge.</td>
            </tr>
            <tr>
              <th scope="row">The host</th>
              <td>Every nickname, wishlist and address (needed to draw), and the pairings in their browser during the draw.</td>
              <td>Your wallet&rsquo;s secret words and your private link.</td>
              <td>Looking at or recording the draw.</td>
            </tr>
            <tr>
              <th scope="row">Your giver</th>
              <td>Your nickname, wishlist and address, the amount they chose to send and any note.</td>
              <td>Anyone else&rsquo;s assignment.</td>
              <td>Telling others who they drew.</td>
            </tr>
            <tr>
              <th scope="row">You, as a recipient</th>
              <td>The payment and memo in your own wallet.</td>
              <td>Who your giver is, unless they reveal.</td>
              <td>Guessing from timing, amount or a note.</td>
            </tr>
            <tr>
              <th scope="row">Other group members</th>
              <td>Nicknames and group-level counts.</td>
              <td>Who drew whom, who has sent, who has confirmed.</td>
              <td>Gossip and guesswork.</td>
            </tr>
            <tr>
              <th scope="row">Anyone holding your private link</th>
              <td>Whatever you can see in Mummer, as you.</td>
              <td>Your wallet.</td>
              <td>The link works like a password: don&rsquo;t share it. If it leaks, use &ldquo;Replace my link.&rdquo;</td>
            </tr>
          </tbody>
        </ResponsiveTable>

      <div className="prose" style={{ marginTop: 'var(--space-7)' }}>
        <h2>What Mummer stores</h2>
        <ul>
          <li>
            <strong>In the clear, by design:</strong> the group name, budget, dates, each person&rsquo;s nickname, and group-level counts.
          </li>
          <li>
            <strong>Sealed (readable only in a browser that holds the key):</strong> each person&rsquo;s wishlist and wallet address (sealed to the host&rsquo;s key) and each assignment (sealed to its giver&rsquo;s key).
          </li>
          <li>
            <strong>Hashed:</strong> your access token, and a one-way fingerprint of each gift reference.
          </li>
          <li>
            <strong>Never:</strong> wallet seed phrases, viewing keys, plain-text addresses or wishlists, memos, or IP addresses in the database.
          </li>
        </ul>
        <p>
          Hosts can open a redacted view of everything stored for their exchange from their admin page. The <Link to="/evidence">evidence page</Link> lists what has and hasn&rsquo;t been verified.
        </p>

        <h2>What we deliberately don&rsquo;t promise</h2>
        <ul>
          <li>We don&rsquo;t say the gifts are &ldquo;anonymous&rdquo; or &ldquo;untraceable.&rdquo; Givers know who they drew, and metadata exists.</li>
          <li>We don&rsquo;t say payments are verified. A recipient&rsquo;s confirmation is a self-report.</li>
          <li>We don&rsquo;t say the host can&rsquo;t see the draw. They can.</li>
          <li>We can&rsquo;t erase screenshots, wallet history or blockchain records, and we can&rsquo;t recover lost links.</li>
        </ul>

        <h2>How long we keep things</h2>
        <p>
          An exchange and everything attached to it is deleted 30 days after its reveal date, or immediately if the host deletes it. Rate-limit records (salted hashes) become eligible for removal after two hours, but cleanup runs once a day, so one can remain for up to about a day. Counters on the <Link to="/stats">public counts</Link> page contain no group or person identifiers.
        </p>

        <h2>Reducing your own exposure</h2>
        <ul>
          <li>Use a fresh receiving address for each exchange.</li>
          <li>Pick a host who isn&rsquo;t playing if secrecy from the organizer matters.</li>
          <li>Skip the personal note if you don&rsquo;t want a recipient to guess you.</li>
          <li>Send at a different time from other participants if timing worries you.</li>
          <li>Never type your wallet&rsquo;s secret words into any website, including this one.</li>
        </ul>
      </div>
    </PageContainer>
  );
}
