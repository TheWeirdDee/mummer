import { PageContainer } from '../components/Layout';
import { MaskIcon } from '../components/Mask';
import { LinkButton } from '../components/ui';
import { usePageMeta } from '../lib/hooks';

export function NotFound() {
  usePageMeta('Page not found | Mummer', 'That page could not be found.', { index: false });
  return (
    <PageContainer narrow>
      <div className="page-head center">
        <div style={{ width: 'min(14rem, 60%)', margin: '0 auto var(--space-5)' }}>
          <MaskIcon fill="var(--ink)" />
        </div>
        <p className="eyebrow">Error 404</p>
        <h1>This mask is empty</h1>
        <p className="lede" style={{ marginInline: 'auto' }}>
          We couldn&rsquo;t find that page. If you were following an invite or private link, check that you copied all of it, including the part after the <code>#</code>.
        </p>
        <div className="btn-row" style={{ justifyContent: 'center', marginTop: 'var(--space-5)' }}>
          <LinkButton to="/" variant="primary">Go to the home page</LinkButton>
          <LinkButton to="/recover">I lost my link</LinkButton>
        </div>
      </div>
    </PageContainer>
  );
}
