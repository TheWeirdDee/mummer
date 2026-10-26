import { Link } from 'react-router-dom';
import { MaskIcon, MaskRing } from '../components/Mask';
import { Disclosure, LinkButton } from '../components/ui';
import { usePageMeta } from '../lib/hooks';

export function Landing() {
  usePageMeta('Mummer: Secret Santa with private gifts', 'Run a Secret Santa where gifts are paid in shielded Zcash from your own wallet. Mummer organizes the draw and never holds money.');
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero__inner">
          <div>
            <p className="eyebrow rise">A masked gift exchange on Zcash</p>
            <h1 id="hero-title" className="rise rise--2">
              Secret Santa.
              <br />
              <span className="accent">Private gifts.</span>
            </h1>
            <p className="lede rise rise--3">
              Mummer draws the names and keeps count. Each gift is a shielded Zcash payment sent from your own wallet, so the payment doesn&rsquo;t announce who gave to whom.
            </p>
            <div className="btn-row rise rise--3" style={{ marginTop: 'var(--space-5)' }}>
              <LinkButton to="/new" variant="primary" size="large">
                Start an exchange
              </LinkButton>
              <LinkButton to="/how-it-works" size="large">
                See how it works
              </LinkButton>
            </div>
            <p className="hero__note">Mummer never holds your money and never asks for your wallet&rsquo;s secret words. You need a Zcash wallet and a few dollars of ZEC. We&rsquo;ll walk you through both.</p>
          </div>
          <div className="hero__art">
            <MaskRing />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="problem-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">Why this exists</p>
            <h2 id="problem-title">Gift exchanges leak more than you&rsquo;d think</h2>
            <p className="lede">Running a Secret Santa with money is easy. Running one that keeps the surprise is not.</p>
          </div>
          <div className="grid-3">
            <article className="card">
              <h3>Public payments tell on you</h3>
              <p>On most blockchains every payment is public. A gift sent that way shows who paid whom, which is exactly what a Secret Santa is meant to hide.</p>
            </article>
            <article className="card">
              <h3>Collecting details is awkward</h3>
              <p>Someone ends up gathering everyone&rsquo;s payment details in a spreadsheet or group chat, then has to keep them safe.</p>
            </article>
            <article className="card">
              <h3>Nobody knows what arrived</h3>
              <p>Organizers spend December asking &ldquo;did yours show up?&rdquo; and trying not to reveal who sent what.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="how-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">Five steps, one link</h2>
          </div>
          <ol className="steps-grid">
            <li>
              <div className="card">
                <h3>Start a group</h3>
                <p>Name it, set a budget and two dates, and share one invite link.</p>
              </div>
            </li>
            <li>
              <div className="card">
                <h3>Everyone joins</h3>
                <p>Each person picks a nickname, adds a wishlist and pastes a fresh shielded receiving address from their wallet.</p>
              </div>
            </li>
            <li>
              <div className="card">
                <h3>The host draws</h3>
                <p>Names are drawn in the host&rsquo;s browser. Each person can open only their own assignment.</p>
              </div>
            </li>
            <li>
              <div className="card">
                <h3>Send your gift</h3>
                <p>Mummer builds a payment request. Your wallet checks it, you approve it, and the gift goes wallet to wallet.</p>
              </div>
            </li>
            <li>
              <div className="card">
                <h3>Confirm and reveal</h3>
                <p>Recipients confirm what arrived. On reveal day, givers can choose to unmask, or stay a mummer.</p>
              </div>
            </li>
          </ol>
          <p style={{ marginTop: 'var(--space-6)' }}>
            <Link to="/how-it-works">Read the full walkthrough</Link>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="privacy-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow">Privacy, in plain words</p>
            <h2 id="privacy-title">What stays private, and what doesn&rsquo;t</h2>
            <p className="lede">We&rsquo;d rather be exact than impressive. Here is the short version.</p>
          </div>
          <div className="privacy-split">
            <div className="card card--pine">
              <h3>
                <MaskIcon fill="var(--gold)" accent="var(--paper)" className="" /> What Mummer helps protect
              </h3>
              <ul>
                <li>The payment itself is shielded, so the public ledger doesn&rsquo;t show sender, recipient or amount.</li>
                <li>Mummer&rsquo;s server stores your wallet address, wishlist and assignment only as sealed data it can&rsquo;t open.</li>
                <li>Each person can open only their own assignment.</li>
                <li>Mummer never holds money and never sees your wallet&rsquo;s secret words.</li>
              </ul>
            </div>
            <div className="card">
              <h3>What it can&rsquo;t hide</h3>
              <ul>
                <li>
                  <strong>The host&rsquo;s browser runs the draw</strong>, so a host who wants to could see every pairing. Pick a host who isn&rsquo;t playing if that matters.
                </li>
                <li>Your giver knows who they drew, and a recipient may guess their giver from timing or a note.</li>
                <li>Your internet provider and Mummer&rsquo;s hosting can see that you visited, even though they can&rsquo;t read your assignment.</li>
                <li>A &ldquo;received it&rdquo; confirmation is one person&rsquo;s word. It is not proof of payment.</li>
              </ul>
            </div>
          </div>
          <p style={{ marginTop: 'var(--space-5)' }}>
            <Link to="/privacy">See exactly who can see what</Link>
          </p>
        </div>
      </section>

      <section className="section section--pine" aria-labelledby="need-title">
        <div className="container">
          <div className="section__head">
            <p className="eyebrow" style={{ color: 'var(--gold-tint)' }}>
              What you need
            </p>
            <h2 id="need-title">A wallet and about ten minutes</h2>
          </div>
          <div className="grid-3">
            <div>
              <h3>A Zcash wallet</h3>
              <p>
                We use <strong>Zodl</strong> in our guides. Any wallet that can show a shielded address and read payment requests should work, and every step has a copy-and-paste fallback.
              </p>
            </div>
            <div>
              <h3>A few dollars of ZEC</h3>
              <p>Gift budgets are small, usually $5 to $50. The wallet guide explains the common ways to get some.</p>
            </div>
            <div>
              <h3>Your own phone or laptop</h3>
              <p>Your private keys are made inside your browser and stay there. Mummer can&rsquo;t recover a lost link, so you&rsquo;ll be asked to save it.</p>
            </div>
          </div>
          <p style={{ marginTop: 'var(--space-5)' }}>
            <Link to="/wallet-guide">New to Zcash? Start with the wallet guide</Link>
          </p>
        </div>
      </section>

      <section className="section faq" aria-labelledby="faq-title">
        <div className="container container--narrow">
          <div className="section__head">
            <p className="eyebrow">Common questions</p>
            <h2 id="faq-title">Before you start</h2>
          </div>
          <Disclosure summary="Does Mummer hold or move my money?">
            <p>No. Every gift goes straight from the giver&rsquo;s wallet to the recipient&rsquo;s wallet. Mummer only helps build the payment request and keeps count of what people report.</p>
          </Disclosure>
          <Disclosure summary="Can the organizer see who drew whom?">
            <p>In this version, yes, if they try: the draw runs in the host&rsquo;s browser. Mummer&rsquo;s server never sees the pairings. If you want the organizer kept out of it, have someone who isn&rsquo;t playing host.</p>
          </Disclosure>
          <Disclosure summary="What does “shielded” mean?">
            <p>It&rsquo;s a kind of Zcash payment where the sender, the recipient and the amount are hidden from the public ledger. Mummer only accepts shielded addresses for gifts.</p>
          </Disclosure>
          <Disclosure summary="What if I lose my link?">
            <p>Mummer can&rsquo;t recover it for you, because the keys never leave your browser. That&rsquo;s why you&rsquo;re asked to save the link, and can add a passphrase-protected backup.</p>
          </Disclosure>
          <p style={{ marginTop: 'var(--space-5)' }}>
            <Link to="/faq">More questions and answers</Link>
          </p>
        </div>
      </section>

      <section className="section section--tint cta-band" aria-labelledby="cta-title">
        <div className="container container--narrow">
          <h2 id="cta-title">Ready to be a mummer?</h2>
          <p className="lede" style={{ marginInline: 'auto' }}>
            Set up an exchange in about two minutes. You&rsquo;ll get an invite link to share.
          </p>
          <LinkButton to="/new" variant="primary" size="large">
            Start an exchange
          </LinkButton>
        </div>
      </section>
    </>
  );
}
