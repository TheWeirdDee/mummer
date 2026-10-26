import { Link } from 'react-router-dom';
import { Notice, LinkButton } from '../components/ui';
import { PageContainer } from '../components/Layout';
import { usePageMeta } from '../lib/hooks';

export function HowItWorks() {
  usePageMeta('How Mummer works', 'A step-by-step look at hosting and joining a Mummer exchange: the draw, sending a shielded gift from your own wallet, confirming receipt and revealing.');
  return (
    <PageContainer>
      <div className="page-head">
        <p className="eyebrow">How it works</p>
        <h1>From invite link to unmasking</h1>
        <p className="lede">Mummer organizes the ritual. Your wallet does the paying. Here is what each person does, and what Mummer can and can&rsquo;t tell you along the way.</p>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card" aria-labelledby="host-title">
          <h2 id="host-title" style={{ fontSize: 'var(--fs-4)' }}>If you&rsquo;re hosting</h2>
          <ol>
            <li>
              <strong>Create the exchange.</strong> Choose a name, a budget in US dollars, a deadline for joining and a reveal date. Your browser makes the host key. Only the public half is sent to Mummer.
            </li>
            <li>
              <strong>Save your admin link.</strong> It&rsquo;s the only way back in. Mummer can&rsquo;t recover it. You&rsquo;ll paste it back to prove you saved it, and only then do you get the invite link.
            </li>
            <li>
              <strong>Share the invite link</strong> with your group. It contains no secrets.
            </li>
            <li>
              <strong>Draw the names</strong> when at least four people are ready. The draw happens in your browser, and each assignment is sealed so only its giver can open it.
            </li>
            <li>
              <strong>Watch the counts.</strong> You see how many gifts people report sent and how many recipients confirmed, never who is who.
            </li>
          </ol>
          <LinkButton to="/new" variant="primary">
            Start an exchange
          </LinkButton>
        </section>

        <section className="card" aria-labelledby="join-title">
          <h2 id="join-title" style={{ fontSize: 'var(--fs-4)' }}>If you&rsquo;re joining</h2>
          <ol>
            <li>
              <strong>Open the invite link</strong> and read what the host can see.
            </li>
            <li>
              <strong>Choose a nickname and a wishlist.</strong> Both are visible to your host. Your wishlist and address are visible to whoever draws you.
            </li>
            <li>
              <strong>Paste a fresh shielded address</strong> from your wallet. The wallet guide shows where to find it. Mummer checks it and tells you why if it can&rsquo;t accept it.
            </li>
            <li>
              <strong>Save your private link.</strong> It&rsquo;s your key to this exchange. A passphrase-protected backup is optional.
            </li>
            <li>
              <strong>After the draw,</strong> open your link to see who you&rsquo;re giving to, then send the gift.
            </li>
          </ol>
          <LinkButton to="/wallet-guide">Set up a wallet</LinkButton>
        </section>
      </div>

      <section className="section" aria-labelledby="send-title">
        <div className="section__head">
          <p className="eyebrow">Sending a gift</p>
          <h2 id="send-title">Your wallet sends it, not Mummer</h2>
        </div>
        <div className="grid-2">
          <div className="prose">
            <p>When you open your assignment, Mummer shows the recipient&rsquo;s nickname, wishlist and budget. It converts the budget from dollars to ZEC using a recent price and shows when that quote expires.</p>
            <p>It then builds a standard payment request with the address, the amount and a short memo that starts with a reference. You can scan it, tap it, or copy each part separately.</p>
            <p>
              <strong>Nothing is sent until you approve it inside your wallet.</strong> Check three things there: the address, the amount and the memo. If any of them is wrong, don&rsquo;t send.
            </p>
          </div>
          <Notice tone="warn" title="Mummer can't see your payment">
            <p>It never sees the transaction, so it can&rsquo;t know if you sent it. The &ldquo;I sent it&rdquo; button is a note you leave for yourself and the group&rsquo;s progress count, not proof.</p>
          </Notice>
        </div>
      </section>

      <section className="section section--tint" style={{ marginInline: 'calc(-1 * var(--gutter))', paddingInline: 'var(--gutter)' }} aria-labelledby="confirm-title">
        <div className="section__head">
          <p className="eyebrow">Receiving</p>
          <h2 id="confirm-title">Confirmed is not the same as verified</h2>
        </div>
        <div className="grid-2">
          <div className="prose">
            <p>When a shielded gift arrives, only the recipient&rsquo;s wallet can see the amount and the memo. The recipient opens their Mummer link and says &ldquo;I received this gift.&rdquo; They can also type the reference from the memo.</p>
            <p>That raises the group&rsquo;s count. We label it exactly what it is: a recipient&rsquo;s own report. Mummer has no way to check a shielded payment on its own, so it never says &ldquo;verified.&rdquo;</p>
          </div>
          <ul>
            <li>
              <strong>Not yet confirmed:</strong> the recipient hasn&rsquo;t said anything.
            </li>
            <li>
              <strong>Confirmed by the recipient:</strong> they said they received it, with or without the reference.
            </li>
            <li>
              <strong>Needs attention:</strong> the recipient reports a problem. Nobody&rsquo;s identity is revealed to the group.
            </li>
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="reveal-title">
        <div className="section__head">
          <p className="eyebrow">Reveal day</p>
          <h2 id="reveal-title">Unmask, or stay a mummer</h2>
        </div>
        <div className="prose">
          <p>From the reveal date, everyone can guess who gave them a gift. A giver can then choose to reveal. They enter the memo reference to show they really held that assignment, and decide whether only the recipient sees it or the whole group does.</p>
          <p>If nobody reveals, the pairings stay private. Mummer never publishes them on its own.</p>
          <p>
            Questions? <Link to="/faq">Read the FAQ</Link> or see the <Link to="/privacy">privacy details</Link>.
          </p>
        </div>
      </section>
    </PageContainer>
  );
}
