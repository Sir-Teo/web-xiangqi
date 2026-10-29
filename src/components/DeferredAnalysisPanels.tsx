import { lazy, Suspense, type ComponentProps } from 'react';
import type { EvalGraph } from './Panels/EvalGraph';
import type { CandidatePanel } from './CandidatePanel';
import type { EnginePanelProps } from './EnginePanel';
import { LazyPanelBoundary } from './LazyPanelBoundary';

const Graph = lazy(() => import('./Panels/EvalGraph').then(module => ({ default: module.EvalGraph })));
const Candidates = lazy(() => import('./CandidatePanel').then(module => ({ default: module.CandidatePanel })));
const Engine = lazy(() => import('./EnginePanel').then(module => ({ default: module.EnginePanel })));

export function DeferredEvalGraph(props: ComponentProps<typeof EvalGraph>) {
  return <LazyPanelBoundary><Suspense fallback={<p role="status">Loading graph…</p>}><Graph {...props} /></Suspense></LazyPanelBoundary>;
}
export function DeferredEnginePanel(props: EnginePanelProps) {
  return <LazyPanelBoundary><Suspense fallback={<p role="status">Loading engine panel…</p>}><Engine {...props} /></Suspense></LazyPanelBoundary>;
}
export function DeferredCandidatePanel(props: ComponentProps<typeof CandidatePanel>) {
  const notice = (failed = false) => <div role={failed ? 'alert' : 'status'}>
    <p>{failed ? 'Candidate comparison could not be loaded. Reload to try again.' : 'Loading candidate comparison…'}</p>
    <button type="button" className="chip-btn" onClick={props.onClose}>Close comparison</button>
  </div>;
  return <LazyPanelBoundary fallback={notice(true)}><Suspense fallback={notice()}><Candidates {...props} /></Suspense></LazyPanelBoundary>;
}
