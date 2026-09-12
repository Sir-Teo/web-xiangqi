import type { StudyAnalysis } from '../utils/studyAnalysis';
import { studyAnalysisScore } from '../utils/studyAnalysis';
import './StudyAnalysisCard.css';

export function StudyAnalysisCard({ analysis, move, onSource }: { analysis: StudyAnalysis; move: string; onSource: () => void }) {
  const boundLabel = analysis.bound === 'lower' ? 'Lower bound' : analysis.bound === 'upper' ? 'Upper bound' : 'Bound';
  return <details className="study-analysis-card" data-testid="saved-analysis-card">
    <summary>Saved analysis · {move} · {studyAnalysisScore(analysis)} Red POV · D{analysis.depth}</summary>
    <p>Captured before this move on {new Date(analysis.savedAt).toLocaleString()}. This snapshot stays as saved when live analysis changes.</p>
    <dl>
      <div><dt>Search</dt><dd>{analysis.candidates ? `Selected candidates: ${analysis.candidates.join(', ')}` : 'All legal moves'} · MultiPV {analysis.multiPv}</dd></div>
      <div><dt>Score</dt><dd>{studyAnalysisScore(analysis)} Red POV · {analysis.bounded ? `${boundLabel}, not an exact score` : 'Exact search score'}</dd></div>
      <div><dt>Engine</dt><dd>{analysis.engine.name}</dd></div>
      <div><dt>Resources</dt><dd>{analysis.engine.variant} · {analysis.engine.threads} thread{analysis.engine.threads === 1 ? '' : 's'} · {analysis.engine.hashMB} MB hash</dd></div>
    </dl>
    <details><summary>Source position and move history</summary><code>{analysis.position}</code></details>
    <button type="button" onClick={onSource}>View source position</button>
  </details>;
}
