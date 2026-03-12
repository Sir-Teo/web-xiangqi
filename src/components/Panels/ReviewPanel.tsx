import { memo } from 'react';
import type { ReviewStatus } from '../../hooks/useGameReview';
import type { ReviewSummary } from '../../utils/review';
import { formatReviewQuality, getMoveQualityClassName } from '../../utils/review';

type Props = {
    status: ReviewStatus;
    progress: number;
    summary: ReviewSummary | null;
    currentNodeId: string;
    canStart: boolean;
    onStart: () => void;
    onCancel: () => void;
    onClear: () => void;
    onNavigateNode: (nodeId: string) => void;
};

export const ReviewPanel = memo(function ReviewPanel({
    status,
    progress,
    summary,
    currentNodeId,
    canStart,
    onStart,
    onCancel,
    onClear,
    onNavigateNode,
}: Props) {
    return (
        <div className="review-panel">
            <div className="review-panel-header">
                <div>
                    <h3>Game Review</h3>
                    <p>Critical moments, engine alternatives, and replay jump points.</p>
                </div>
                <div className="review-panel-actions">
                    {status === 'running' ? (
                        <button type="button" className="chip-btn" onClick={onCancel}>
                            Cancel
                        </button>
                    ) : status === 'done' ? (
                        <>
                            <button type="button" className="chip-btn chip-btn-primary" onClick={onStart}>
                                Re-run
                            </button>
                            <button type="button" className="chip-btn" onClick={onClear}>
                                Clear
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="chip-btn chip-btn-primary"
                            onClick={onStart}
                            disabled={!canStart}
                            data-testid="start-review-btn"
                        >
                            Run Review
                        </button>
                    )}
                </div>
            </div>

            {status === 'running' ? (
                <div className="review-progress-card">
                    <div className="review-progress-copy">
                        <strong>Reviewing line…</strong>
                        <span>{Math.round(progress * 100)}% complete</span>
                    </div>
                    <div className="review-progress-track" aria-hidden="true">
                        <div className="review-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                </div>
            ) : null}

            {status === 'done' && summary ? (
                <>
                    <div className="review-summary-grid">
                        <div className="review-summary-card">
                            <span>Accuracy</span>
                            <strong>{summary.accuracy}%</strong>
                        </div>
                        <div className="review-summary-card">
                            <span>Blunders</span>
                            <strong>{summary.blunderCount}</strong>
                        </div>
                        <div className="review-summary-card">
                            <span>Mistakes</span>
                            <strong>{summary.mistakeCount}</strong>
                        </div>
                        <div className="review-summary-card">
                            <span>Reviewed</span>
                            <strong>{new Date(summary.reviewedAt).toLocaleDateString()}</strong>
                        </div>
                    </div>

                    <div className="review-moment-header">
                        <span>Key moments</span>
                        <strong>{summary.keyMoments.length}</strong>
                    </div>

                    {summary.keyMoments.length > 0 ? (
                        <div className="review-moment-list">
                            {summary.keyMoments.map((moment) => (
                                <button
                                    key={`${moment.moveIndex}-${moment.nodeId}`}
                                    type="button"
                                    className={[
                                        'review-moment-card',
                                        getMoveQualityClassName(moment.quality),
                                        currentNodeId === moment.nodeId ? 'review-moment-card-active' : '',
                                    ].join(' ')}
                                    onClick={() => onNavigateNode(moment.nodeId)}
                                    data-testid={`review-moment-${moment.moveIndex}`}
                                >
                                    <div className="review-moment-topline">
                                        <span>{formatReviewQuality(moment.quality)}</span>
                                        <strong>{moment.side} · ply {moment.ply}</strong>
                                    </div>
                                    <div className="review-moment-main">
                                        <span>{moment.playedMove.toUpperCase()}</span>
                                        <strong>{formatSwing(moment.swing)}</strong>
                                    </div>
                                    <p>{moment.note}</p>
                                    {moment.bestMove ? (
                                        <em>Engine line: {moment.bestMove.toUpperCase()}</em>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="empty-state">
                            <p>No critical moments in this line. That review came back clean.</p>
                        </div>
                    )}
                </>
            ) : null}

            {status === 'idle' ? (
                <div className="empty-state">
                    <p>Run a review to rank the line, capture the engine alternatives, and jump through the biggest swings.</p>
                </div>
            ) : null}
        </div>
    );
});

ReviewPanel.displayName = 'ReviewPanel';

function formatSwing(swing: number) {
    return `${Math.round(swing)}cp`;
}
