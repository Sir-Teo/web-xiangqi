import { memo } from 'react';
import type { ReviewStatus } from '../../hooks/useGameReview';
import type { ReviewKeyMoment, ReviewSummary } from '../../utils/review';
import {
    describeReviewEngineSummary,
    formatWinPercentLoss,
    formatWinPercentLossLabel,
    formatReviewEngineSummary,
    formatReviewQuality,
    formatReviewQualityCount,
    getWinPercentLossForMove,
    getMoveQualityClassName,
} from '../../utils/review';
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
    const focusMoment = summary?.keyMoments[0] ?? null;
    const reviewEngineLabel = formatReviewEngineSummary(summary?.engine);
    const reviewEngineDetail = `Review engine: ${describeReviewEngineSummary(summary?.engine)}`;
    const sideAccuracyBreakdown = summary ? [
        { key: 'red', label: 'Red', value: summary.redAccuracy },
        { key: 'black', label: 'Black', value: summary.blackAccuracy },
    ].filter((item): item is { key: 'red' | 'black'; label: string; value: number } => typeof item.value === 'number') : [];
    const qualityBreakdown = summary ? [
        { key: 'best', label: 'Best', count: summary.bestCount },
        { key: 'good', label: 'Good', count: summary.goodCount },
        { key: 'inaccuracy', label: 'Inaccuracy', count: summary.inaccuracyCount },
        { key: 'mistake', label: 'Mistake', count: summary.mistakeCount },
        { key: 'blunder', label: 'Blunder', count: summary.blunderCount },
    ] as const : [];

    return (
        <div className="review-panel">
            <div className="review-panel-header">
                <div>
                    <h3>Game Review</h3>
                    <p>Critical moments, engine alternatives, and replay jump points.</p>
                </div>
                <div className="review-panel-actions">
                    {status === 'running' ? (
                        <button
                            type="button"
                            className="chip-btn"
                            onClick={onCancel}
                            title="Cancel running game review"
                            aria-label="Cancel running game review"
                            data-testid="cancel-review-btn"
                        >
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
                                aria-label={canStart ? 'Re-run game review' : `Re-run game review unavailable: ${startTitle ?? 'not ready'}`}
                                data-testid="rerun-review-btn"
                            >
                                Re-run
                            </button>
                            <button
                                type="button"
                                className="chip-btn"
                                onClick={onClear}
                                title="Clear completed game review"
                                aria-label="Clear completed game review"
                                data-testid="clear-review-btn"
                            >
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
                            aria-label={canStart ? 'Run game review' : `Game review unavailable: ${startTitle ?? 'not ready'}`}
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
                        {sideAccuracyBreakdown.map((item) => (
                            <div
                                key={item.key}
                                className="review-summary-card"
                                data-testid={`review-${item.key}-accuracy`}
                                aria-label={`${item.label} accuracy ${item.value}%`}
                                title={`${item.label} accuracy ${item.value}%`}
                            >
                                <span>{item.label}</span>
                                <strong>{item.value}%</strong>
                            </div>
                        ))}
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
                        <div
                            className="review-summary-card review-summary-card-wide"
                            data-testid="review-engine-summary"
                            aria-label={reviewEngineDetail}
                            title={reviewEngineDetail}
                        >
                            <span>Engine</span>
                            <strong>{reviewEngineLabel}</strong>
                        </div>
                    </div>

                    <div className="review-quality-breakdown" aria-label="Review quality breakdown">
                        {qualityBreakdown.map((item) => {
                            const countLabel = formatReviewQualityCount(item.key, item.count);
                            return (
                                <div
                                    key={item.key}
                                    className={`review-quality-chip ${getMoveQualityClassName(item.key)}`}
                                    data-testid={`review-quality-${item.key}`}
                                    aria-label={countLabel}
                                    title={countLabel}
                                >
                                    <span>{item.label}</span>
                                    <strong>{item.count}</strong>
                                </div>
                            );
                        })}
                    </div>

                    <div className="review-focus-card" data-testid="review-focus-card">
                        <span>Study focus</span>
                        {focusMoment ? (
                            <>
                                <strong>{formatReviewQuality(focusMoment.quality)} at ply {focusMoment.ply}</strong>
                                <div
                                    className="review-eval-transition"
                                    data-testid="review-focus-eval"
                                    aria-label={`Red evaluation changed from ${formatReviewEvalScore(focusMoment.evalBefore)} to ${formatReviewEvalScore(focusMoment.evalAfter)}`}
                                    title={`Red POV: ${formatReviewEvalTransition(focusMoment.evalBefore, focusMoment.evalAfter)}`}
                                >
                                    <span>Eval</span>
                                    <strong>{formatReviewEvalScore(focusMoment.evalBefore)}</strong>
                                    <em aria-hidden="true">→</em>
                                    <strong>{formatReviewEvalScore(focusMoment.evalAfter)}</strong>
                                </div>
                                <div
                                    className="review-chance-loss"
                                    data-testid="review-focus-chance"
                                    aria-label={formatReviewChanceLossLabel(focusMoment)}
                                    title={formatReviewChanceLossLabel(focusMoment)}
                                >
                                    <span>Chance</span>
                                    <strong>{formatReviewChanceLoss(focusMoment)}</strong>
                                </div>
                                {focusMoment.bestMove ? (
                                    <em>Try {formatUciMove(focusMoment.bestMove)}</em>
                                ) : null}
                                <p>{focusMoment.note}</p>
                            </>
                        ) : (
                            <>
                                <strong>Clean main line</strong>
                                <p>No critical swings found in this review.</p>
                            </>
                        )}
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
                                        aria-label={`${formatReviewQuality(moment.quality)} review moment, ${moment.side} ply ${moment.ply}, played ${formatUciMove(moment.playedMove)}, swing ${formatSwing(moment.swing)}, ${formatReviewChanceLossLabel(moment)}, red evaluation changed from ${formatReviewEvalScore(moment.evalBefore)} to ${formatReviewEvalScore(moment.evalAfter)}${moment.bestMove ? `, engine suggested ${formatUciMove(moment.bestMove)}` : ''}`}
                                    >
                                        <div className="review-moment-topline">
                                            <span>{formatReviewQuality(moment.quality)}</span>
                                            <strong>{moment.side} · ply {moment.ply}</strong>
                                        </div>
                                        <div className="review-moment-main">
                                            <span>{formatUciMove(moment.playedMove)}</span>
                                            <strong>{formatSwing(moment.swing)}</strong>
                                        </div>
                                        <div
                                            className="review-moment-eval"
                                            data-testid={`review-moment-eval-${moment.moveIndex}`}
                                            aria-label={`Red evaluation changed from ${formatReviewEvalScore(moment.evalBefore)} to ${formatReviewEvalScore(moment.evalAfter)}`}
                                            title={`Red POV: ${formatReviewEvalTransition(moment.evalBefore, moment.evalAfter)}`}
                                        >
                                            <span>Eval</span>
                                            <strong>{formatReviewEvalScore(moment.evalBefore)}</strong>
                                            <em aria-hidden="true">→</em>
                                            <strong>{formatReviewEvalScore(moment.evalAfter)}</strong>
                                        </div>
                                        <div
                                            className="review-chance-loss"
                                            data-testid={`review-moment-chance-${moment.moveIndex}`}
                                            aria-label={formatReviewChanceLossLabel(moment)}
                                            title={formatReviewChanceLossLabel(moment)}
                                        >
                                            <span>Chance</span>
                                            <strong>{formatReviewChanceLoss(moment)}</strong>
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

function formatReviewEvalScore(score: number) {
    if (!Number.isFinite(score)) return 'n/a';
    return `${score > 0 ? '+' : ''}${(score / 100).toFixed(2)}`;
}

function formatReviewEvalTransition(evalBefore: number, evalAfter: number) {
    return `${formatReviewEvalScore(evalBefore)} → ${formatReviewEvalScore(evalAfter)}`;
}

function getMomentWinPercentLoss(moment: ReviewKeyMoment) {
    return typeof moment.winPercentLoss === 'number'
        ? Math.max(0, Math.min(100, moment.winPercentLoss))
        : getWinPercentLossForMove(moment.evalBefore, moment.evalAfter, moment.side);
}

function formatReviewChanceLoss(moment: ReviewKeyMoment) {
    return formatWinPercentLoss(getMomentWinPercentLoss(moment));
}

function formatReviewChanceLossLabel(moment: ReviewKeyMoment) {
    return formatWinPercentLossLabel(getMomentWinPercentLoss(moment), moment.side);
}
