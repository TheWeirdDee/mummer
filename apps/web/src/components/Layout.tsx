import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Logo } from './Mask';
import { Badge, LinkButton } from './ui';

/* ---------- Shared route chrome ---------- */

function ScrollAndAnnounce() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    // Keyboard and screen-reader users land at the new page's heading.
    const h = document.querySelector<HTMLElement>('main h1');
    if (h) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }, [pathname]);
  return null;
}

function SkipLink() {
  return (
    <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.setAttribute('tabindex', '-1'); m?.focus(); }}>
      Skip to content
    </a>
  );
}

/* ---------- Marketing layout: full navigation and a footer ---------- */

const NAV = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/wallet-guide', label: 'Wallet guide' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/faq', label: 'FAQ' },
];

export function MarketingLayout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <SkipLink />
      <ScrollAndAnnounce />
      <header className="site-header">
        <div className="container site-header__inner">
          <Link to="/" className="brand" aria-label="Mummer, home">
            <Logo />
            <span>Mummer</span>
          </Link>
          <button type="button" className="btn btn--secondary btn--small nav-toggle" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen((o) => !o)}>
            {open ? 'Close' : 'Menu'}
          </button>
          <nav className="nav" id="site-nav" aria-label="Main" data-open={open}>
            <ul className="nav__links">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to}>{n.label}</NavLink>
                </li>
              ))}
            </ul>
            <LinkButton to="/new" variant="primary" size="small">
              Start an exchange
            </LinkButton>
          </nav>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <SiteFooter />
    </>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div>
          <Link to="/" className="brand" style={{ color: 'var(--paper)' }} aria-label="Mummer, home">
            <Logo />
            <span>Mummer</span>
          </Link>
          <p style={{ marginTop: 'var(--space-4)', maxWidth: '28rem', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)', color: '#d8d0bd' }}>
            Mummers were masked holiday visitors whose hosts had to guess who they were. This is a Secret Santa that works the same way, with private gifts.
          </p>
        </div>
        <div>
          <h2>Learn</h2>
          <ul>
            <li><Link to="/how-it-works">How it works</Link></li>
            <li><Link to="/wallet-guide">Wallet guide</Link></li>
            <li><Link to="/privacy">Privacy</Link></li>
            <li><Link to="/faq">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <h2>Trust</h2>
          <ul>
            <li><Link to="/evidence">Evidence and limits</Link></li>
            <li><Link to="/stats">Public counts</Link></li>
            <li><Link to="/recover">Lost a link?</Link></li>
            <li><Link to="/new">Start an exchange</Link></li>
          </ul>
        </div>
      </div>
      <div className="site-footer__fine">
        <div className="container">
          <p>
            Mummer never holds or moves money and never asks for seed phrases or viewing keys. It is not a wallet, an exchange or financial advice. Gifts are paid from participants&rsquo; own wallets;
            check every payment in your wallet before approving it.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ---------- App layout: compact header, contextual info, NO footer ---------- */

interface Chrome {
  title?: string;
  role?: string;
}
const ChromeContext = createContext<{ chrome: Chrome; setChrome: (c: Chrome) => void }>({ chrome: {}, setChrome: () => undefined });

export function useAppChrome(chrome: Chrome) {
  const { setChrome } = useContext(ChromeContext);
  const { title, role } = chrome;
  useEffect(() => {
    setChrome({ title, role });
    return () => setChrome({});
  }, [title, role, setChrome]);
}

export function AppLayout() {
  const [chrome, setChrome] = useState<Chrome>({});
  return (
    <ChromeContext.Provider value={{ chrome, setChrome }}>
      <SkipLink />
      <ScrollAndAnnounce />
      <header className="app-header">
        <div className="container app-header__inner">
          <Link to="/" className="brand" aria-label="Mummer, home">
            <Logo />
            <span>Mummer</span>
          </Link>
          <div className="app-header__context">
            {chrome.title && <span className="title">{chrome.title}</span>}
            {chrome.role && <Badge tone="pine">{chrome.role}</Badge>}
            <a href="/wallet-guide" target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 'var(--fs-1)' }}>
              Wallet help<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </header>
      <main id="main" className="app-main">
        <Outlet />
      </main>
    </ChromeContext.Provider>
  );
}

export function PageContainer({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`container${narrow ? ' container--narrow' : ''}`}>{children}</div>;
}
