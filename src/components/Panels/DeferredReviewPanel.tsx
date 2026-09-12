import { lazy, Suspense, type ComponentProps } from 'react';
import type { ReviewPanel } from './ReviewPanel';
import { LazyPanelBoundary } from '../LazyPanelBoundary';

const Panel = lazy(() => import('./ReviewPanel').then(module => ({ default: module.ReviewPanel })));
type Props = ComponentProps<typeof ReviewPanel>;

function ReviewNotice({ failed = false, status, onCancel }: Pick<Props, 'status' | 'onCancel'> & { failed?: boolean }) {
  return <div className={failed ? 'lazy-panel-error' : 'panel-loading'} role={failed ? 'alert' : 'status'} data-testid={failed ? 'review-load-error' : 'review-loading'}>
    <p>{failed ? 'Review could not be loaded. Reload the page to try again. Your study is still available.' : 'Loading review…'}</p>
    {status === 'running' && <button type="button" className="chip-btn" onClick={onCancel}>Cancel review</button>}
  </div>;
}

export function DeferredReviewPanel(props: Props) {
  return <LazyPanelBoundary fallback={<ReviewNotice status={props.status} onCancel={props.onCancel} failed />}>
    <Suspense fallback={<ReviewNotice status={props.status} onCancel={props.onCancel} />}><Panel {...props} /></Suspense>
  </LazyPanelBoundary>;
}
