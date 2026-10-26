import { PageContainer } from '../components/Layout';
import { Notice, SkeletonLines } from '../components/ui';
import { api } from '../lib/api';
import { useAsync, usePageMeta } from '../lib/hooks';

export function Stats() {
  usePageMeta('Public counts | Mummer', 'Aggregate Mummer counts: exchanges, participants and confirmed gifts. No personal or per-group data.');
  const { data, error, loading } = useAsync((s) => api.stats().then((r) => r), []);
  return (
    <PageContainer narrow>
      <div className="page-head">
        <p className="eyebrow">Public counts</p>
        <h1>The numbers, and only the numbers</h1>
        <p className="lede">Totals across every exchange, with no names, groups or dates. They&rsquo;re rounded down to the nearest five, and hidden until enough exchanges exist that no single group stands out.</p>
      </div>
      {loading && <SkeletonLines lines={3} />}
      {error && <Notice tone="danger" title="We couldn't load the counts">{error.message}</Notice>}
      {data && data.available && (
        <div className="stat-row" role="group" aria-label="Public counts">
          <div className="stat"><div className="stat__n">{data.groups}+</div><div className="stat__l">Exchanges created</div></div>
          <div className="stat"><div className="stat__n">{data.members}+</div><div className="stat__l">People joined</div></div>
          <div className="stat"><div className="stat__n">{data.giftsAcknowledged}+</div><div className="stat__l">Gifts confirmed by recipients</div></div>
        </div>
      )}
      {data && !data.available && <Notice tone="info" title="Not enough activity yet">{data.reason}</Notice>}
      <p className="muted">&ldquo;Confirmed&rdquo; means the recipient said they received a gift. It is not proof of payment. Counts come only from this deployment; they are not a measure of adoption anywhere else.</p>
    </PageContainer>
  );
}
