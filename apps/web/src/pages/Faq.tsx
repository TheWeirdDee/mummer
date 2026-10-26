import { Link } from 'react-router-dom';
import { PageContainer } from '../components/Layout';
import { Disclosure } from '../components/ui';
import { usePageMeta } from '../lib/hooks';

export function Faq() {
  usePageMeta('Questions and answers | Mummer', 'Answers about how Mummer works, what it stores, shielded gifts, lost links, reveals and what it cannot promise.');
  return (
    <PageContainer narrow>
      <div className="page-head">
        <p className="eyebrow">FAQ</p>
        <h1>Questions, answered straight</h1>
        <p className="lede">If something here sounds too good to be true, check the matching note on the privacy page. We list the limits there.</p>
      </div>
      <div className="faq">
        <Disclosure summary="What is Mummer, in one sentence?">
          <p>A Secret Santa organizer where each gift is a shielded Zcash payment sent from the giver&rsquo;s own wallet, so the payment doesn&rsquo;t publicly show who gave to whom.</p>
        </Disclosure>
        <Disclosure summary="Does Mummer hold, move or touch my money?">
          <p>No. It never has your funds, your wallet&rsquo;s secret words, or a viewing key. It builds a payment request; your wallet decides whether to send it and you approve it there.</p>
        </Disclosure>
        <Disclosure summary="What does “shielded” mean?">
          <p>Zcash has a transparent side, like most blockchains, and a shielded side. A shielded payment hides the sender, recipient and amount from the public ledger. Mummer accepts only shielded addresses for gifts and tells you why if you paste something else.</p>
        </Disclosure>
        <Disclosure summary="Can the host see who drew whom?">
          <p>
            Yes, if they try. The draw runs in the host&rsquo;s browser, which has to know everyone&rsquo;s details to do it. Mummer&rsquo;s server does not see the pairings. If you want the organizer kept out of it, have a host who isn&rsquo;t playing. See{' '}
            <Link to="/privacy">who can see what</Link>.
          </p>
        </Disclosure>
        <Disclosure summary="Can my giver tell it's me?">
          <p>Your giver knows who they drew, so they know who they&rsquo;re buying for. You may be able to guess who gave you a gift from timing, the amount or a note. Everyone else in the group sees only counts.</p>
        </Disclosure>
        <Disclosure summary="Does “confirmed” mean the payment is verified?">
          <p>No. A confirmation is the recipient saying they received the gift. Mummer can&rsquo;t look inside a shielded payment, so it doesn&rsquo;t call anything verified. A reference in the memo helps a recipient tie a payment to the exchange, but it isn&rsquo;t proof.</p>
        </Disclosure>
        <Disclosure summary="What if I lose my private link?">
          <p>
            Mummer can&rsquo;t recover it: the secret key that opens your assignment only ever existed in your browser. Before the draw you can rejoin with a new link and the host removes the old entry. After the draw, a passphrase-protected backup is the only recovery. See{' '}
            <Link to="/recover">recovery options</Link>.
          </p>
        </Disclosure>
        <Disclosure summary="What if my link leaks?">
          <p>Use &ldquo;Replace my link&rdquo; on your exchange page. It issues new credentials and re-seals your assignment to them. Anyone who already used the old link could have seen what you could see, so treat it as a password.</p>
        </Disclosure>
        <Disclosure summary="What if my wallet doesn't fill in the amount or memo when I scan?">
          <p>Some wallets or versions ignore parts of a payment request. Every piece has its own copy button: the address, the amount and the memo. Paste them into your wallet and check them before you send.</p>
        </Disclosure>
        <Disclosure summary="What if a gift never arrives?">
          <p>The recipient can mark &ldquo;Something&rsquo;s wrong.&rdquo; The host sees only a count of exchanges that need attention, not who. Resolving it happens outside Mummer, for example with a group-wide message. Mummer can&rsquo;t refund or retry a payment because it never held it.</p>
        </Disclosure>
        <Disclosure summary="Can a company pay for everyone's gifts?">
          <p>Not in this version. Each giver pays from their own wallet. A funding mode would need one separate payment per person, because the wallet we use rejects requests with several recipients, and it needs a privacy review of who funded whom.</p>
        </Disclosure>
        <Disclosure summary="How long is my data kept?">
          <p>Thirty days after the reveal date, or immediately if the host deletes the exchange. We can&rsquo;t delete screenshots, wallet history or blockchain records.</p>
        </Disclosure>
        <Disclosure summary="Why does Mummer ask me to save a link?">
          <p>There are no accounts, emails or passwords. Your private link is your account. It carries your key after the # sign, which browsers don&rsquo;t send to servers.</p>
        </Disclosure>
        <Disclosure summary="Is Mummer financial or legal advice?">
          <p>No. Check the rules where you live about sending and receiving crypto. Keep budgets small and only send what you can afford to lose.</p>
        </Disclosure>
      </div>
    </PageContainer>
  );
}
