import { memo } from 'react';
import type { ReviewStatus } from '../../hooks/useGameReview';
import type { ReviewSummary } from '../../utils/review';
import { formatReviewQuality, getMoveQualityClassName } from '../../utils/review';
import { formatUciMove } from '../../utils/moveNotation';

type Props = {
    status: ReviewStatus;
    progress: number;
    summary: ReviewSummary | null;
    currentNodeId: string;
    canStart: boolean;
    startLabel?: string;
    startTitle?: string;
    onStart: () => void;
    onCancel: () => void;
    onClear: () => void;
    onNavigateNode: (nodeId: string) => void;
    onPlayBestMove?: (nodeId: string, bestMove: string) => void;
};

export const ReviewPanel = memo(function ReviewPanel({
    status,
    progress,
    summary,
    currentNodeId,
    canStart,
    startLabel,
    startTitle,
    onStart,
    onCancel,
    onClear,
    onNavigateNode,
    onPlayBestMove,
}: Props) {
    const progressPercent = Math.max(0, Math.min(100, Math.round(progress * 100)));

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
                            <button
                                type="button"
                                className="chip-btn chip-btn-primary"
                                onClick={onStart}
                                disabled={!canStart}
                                title={startTitle}
                                data-testid="rerun-review-btn"
                            >
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
                            title={startTitle}
                            data-testid="start-review-btn"
                        >
                            {startLabel ?? (canStart ? 'Run Review' : 'Engine Loading')}
                        </button>
                    )}
                </div>
            </div>

            {status === 'running' ? (
                <div className="review-progress-card">
                    <div className="review-progress-copy">
                        <strong>Reviewing line…</strong>
                        <span>{progressPercent}% complete</span>
                    </div>
                    <div
                        className="review-progress-track"
                        role="progressbar"
                        aria-label="Game review progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progressPercent}
                        aria-valuetext={`${progressPercent}% complete`}
                    >
                        <div className="review-progress-fill" style={{ width: `${progressPercent}%` }} />
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
                                <div key={`${moment.moveIndex}-${moment.nodeId}`} className="review-moment-entry">
                                    <button
                                        type="button"
                                        className={[
                                            'review-moment-card',
                                            getMoveQualityClassName(moment.quality),
                                            currentNodeId === moment.nodeId ? 'review-moment-card-active' : '',
                                        ].join(' ')}
                                        onClick={() => onNavigateNode(moment.nodeId)}
                                        data-testid={`review-moment-${moment.moveIndex}`}
                                        aria-current={currentNodeId === moment.nodeId ? 'true' : undefined}
                                        aria-label={`${formatReviewQuality(moment.quality)} review moment, ${moment.side} ply ${moment.ply}, played ${formatUciMove(moment.playedMove)}, swing ${formatSwing(moment.swing)}${moment.bestMove ? `, engine suggested ${formatUciMove(moment.bestMove)}` : ''}`}
                                    >
                                        <div className="review-moment-topline">
                                            <span>{formatReviewQuality(moment.quality)}</span>
                                            <strong>{moment.side} · ply {moment.ply}</strong>
                                        </div>
                                        <div className="review-moment-main">
                                            <span>{formatUciMove(moment.playedMove)}</span>
                                            <strong>{formatSwing(moment.swing)}</strong>
                                        </div>
                                        <p>{moment.note}</p>
                                        {moment.bestMove ? (
                                            <em>Best: {formatUciMove(moment.bestMove)}</em>
                                        ) : null}
                                    </button>
                                    {moment.bestMove && onPlayBestMove ? (
                                        <button
                                            type="button"
                                            className="review-best-move-btn"
                                            onClick={() => onPlayBestMove(moment.nodeId, moment.bestMove!)}
                                            data-testid={`review-try-best-${moment.moveIndex}`}
                                            aria-label={`Try engine suggestion ${formatUciMove(moment.bestMove)} instead of ${formatUciMove(moment.playedMove)}`}
                                        >
                                            Try best <strong>{formatUciMove(moment.bestMove)}</strong>
                                        </button>
                                    ) : null}
                                </div>
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
