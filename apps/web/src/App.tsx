import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout, MarketingLayout, PageContainer } from './components/Layout';
import { SkeletonLines } from './components/ui';
import { Landing } from './pages/Landing';

// Pages that handle keys are code-split: libsodium (with its embedded WebAssembly) never loads on public pages.
const HowItWorks = lazy(() => import('./pages/HowItWorks').then((m) => ({ default: m.HowItWorks })));
const Privacy = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.Privacy })));
const Faq = lazy(() => import('./pages/Faq').then((m) => ({ default: m.Faq })));
const WalletGuide = lazy(() => import('./pages/WalletGuide').then((m) => ({ default: m.WalletGuide })));
const Evidence = lazy(() => import('./pages/Evidence').then((m) => ({ default: m.Evidence })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));
const CreateGroup = lazy(() => import('./pages/CreateGroup').then((m) => ({ default: m.CreateGroup })));
const JoinGroup = lazy(() => import('./pages/JoinGroup').then((m) => ({ default: m.JoinGroup })));
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const MemberPage = lazy(() => import('./pages/member/MemberPage').then((m) => ({ default: m.MemberPage })));
const Recover = lazy(() => import('./pages/Recover').then((m) => ({ default: m.Recover })));

function Loading() {
  return (
    <PageContainer narrow>
      <div style={{ paddingBlock: 'var(--space-8)' }} role="status" aria-label="Loading page">
        <SkeletonLines lines={4} />
      </div>
    </PageContainer>
  );
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route index element={<Landing />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="faq" element={<Faq />} />
          <Route path="wallet-guide" element={<WalletGuide />} />
          <Route path="evidence" element={<Evidence />} />
          <Route path="stats" element={<Stats />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route element={<AppLayout />}>
          <Route path="new" element={<CreateGroup />} />
          <Route path="recover" element={<Recover />} />
          <Route path="g/:gid" element={<JoinGroup />} />
          <Route path="g/:gid/admin" element={<AdminPage />} />
          <Route path="g/:gid/m/:mid" element={<MemberPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
