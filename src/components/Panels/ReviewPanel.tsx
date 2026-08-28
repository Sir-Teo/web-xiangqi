import { memo, useEffect, useMemo, useState } from 'react';
import type { ReviewStatus } from '../../hooks/useGameReview';
import type { PhaseAccuracySummary, ReviewKeyMoment, ReviewSide, ReviewSummary } from '../../utils/review';
import { type NarrativeTag, narrativeTagToneClass } from '../../utils/narrativeTags';
import {
    describeReviewEngineSummary,
    formatWinPercentLoss,
    formatWinPercentLossLabel,
    formatReviewEngineSummary,
    formatReviewQuality,
    formatReviewQualityCount,
    formatAverageCentipawnLoss,
    getWinPercentLossForMove,
    getMoveQualityClassName,
} from '../../utils/review';
import { formatUciMove } from '../../utils/moveNotation';

type Props = {
    status: ReviewStatus;
    progress: number;
    summary: ReviewSummary | null;
    /** Describes the shape of the game; empty when there is nothing to say. */
    narrativeTags?: NarrativeTag[];
    /** Accuracy per phase; empty when the game never left one. */
    phaseAccuracy?: PhaseAccuracySummary[];
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

type ReviewMomentSideFilter = 'all' | 'red' | 'black';
type ReviewMomentQualityFilter = 'all' | 'inaccuracy' | 'mistake' | 'blunder';

export const ReviewPanel = memo(function ReviewPanel({
    status,
    progress,
    narrativeTags = [],
    phaseAccuracy = [],
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
    const [momentSideFilter, setMomentSideFilter] = useState<ReviewMomentSideFilter>('all');
    const [momentQualityFilter, setMomentQualityFilter] = useState<ReviewMomentQualityFilter>('all');
    useEffect(() => {
        setMomentSideFilter('all');
        setMomentQualityFilter('all');
    }, [status, summary?.lineSignature, summary?.reviewedAt]);

    const progressPercent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    const focusMoment = summary?.keyMoments[0] ?? null;
    const reviewEngineLabel = formatReviewEngineSummary(summary?.engine);
    const reviewEngineDetail = `Review engine: ${describeReviewEngineSummary(summary?.engine)}`;
    const averageLossLabel = typeof summary?.averageCentipawnLoss === 'number'
        ? `Average centipawn loss ${formatAverageCentipawnLoss(summary.averageCentipawnLoss)}`
        : '';
    const sideAccuracyBreakdown = summary ? [
        { key: 'red', label: 'Red', value: summary.redAccuracy, loss: summary.redAverageCentipawnLoss },
        { key: 'black', label: 'Black', value: summary.blackAccuracy, loss: summary.blackAverageCentipawnLoss },
    ].filter((item): item is { key: 'red' | 'black'; label: string; value: number; loss: number | undefined } => typeof item.value === 'number') : [];
    const qualityBreakdown = summary ? [
        { key: 'best', label: 'Best', count: summary.bestCount },
        { key: 'good', label: 'Good', count: summary.goodCount },
        { key: 'inaccuracy', label: 'Inaccuracy', count: summary.inaccuracyCount },
        { key: 'mistake', label: 'Mistake', count: summary.mistakeCount },
        { key: 'blunder', label: 'Blunder', count: summary.blunderCount },
    ] as const : [];
    const filteredKeyMoments = useMemo(() => {
        if (!summary) return [];
        return summary.keyMoments.filter((moment) => {
            if (momentSideFilter !== 'all' && moment.side !== momentSideFilter) return false;
            if (momentQualityFilter !== 'all' && moment.quality !== momentQualityFilter) return false;
            return true;
        });
    }, [momentQualityFilter, momentSideFilter, summary]);
    const totalKeyMoments = summary?.keyMoments.length ?? 0;

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
                            // Enabled, the visible text is the name; see the bottom
                            // bar's matching button in App.tsx.
                            aria-label={canStart ? undefined : `Game review unavailable: ${startTitle ?? 'not ready'}`}
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
                        {typeof summary.averageCentipawnLoss === 'number' ? (
                            <div
                                className="review-summary-card"
                                data-testid="review-average-loss"
                                aria-label={averageLossLabel}
                                title={averageLossLabel}
                            >
                                <span>Avg loss</span>
                                <strong>{formatAverageCentipawnLoss(summary.averageCentipawnLoss)}</strong>
                            </div>
                        ) : null}
                        {sideAccuracyBreakdown.map((item) => (
                            <div
                                key={item.key}
                                className="review-summary-card"
                                data-testid={`review-${item.key}-accuracy`}
                                aria-label={`${item.label} accuracy ${item.value}%${typeof item.loss === 'number' ? `, average centipawn loss ${formatAverageCentipawnLoss(item.loss)}` : ''}`}
                                title={`${item.label} accuracy ${item.value}%${typeof item.loss === 'number' ? `, average centipawn loss ${formatAverageCentipawnLoss(item.loss)}` : ''}`}
                            >
                                <span>{item.label}</span>
                                <strong>{item.value}%</strong>
                                {typeof item.loss === 'number' ? (
                                    <em>{formatAverageCentipawnLoss(item.loss)} loss</em>
                                ) : null}
                            </div>
                        ))}
                        {/* Blunder and mistake counts live in the quality breakdown a few
                            pixels below; repeating them here said the same thing twice.
                            The run date belongs with the engine settings it describes. */}
                        <div
                            className="review-summary-card review-summary-card-wide"
                            data-testid="review-engine-summary"
                            aria-label={reviewEngineDetail}
                            title={reviewEngineDetail}
                        >
                            <span>Engine</span>
                            <strong>{reviewEngineLabel}</strong>
                            <em>Reviewed {new Date(summary.reviewedAt).toLocaleDateString(undefined, {
                                year: 'numeric', month: 'short', day: 'numeric',
                            })}</em>
                        </div>
                    </div>

                    {phaseAccuracy.length > 1 ? (
                        <div className="review-phase-accuracy" aria-label="Accuracy by phase">
                            {phaseAccuracy.map((phase) => (
                                <div key={phase.phase} className="review-phase-row">
                                    <span className="review-phase-label">{phase.label}</span>
                                    <span className="review-phase-scores">
                                        {typeof phase.redAccuracy === 'number' ? (
                                            <span aria-label={`Red accuracy in the ${phase.label.toLowerCase()} ${phase.redAccuracy}%`}>
                                                <i aria-hidden="true">R</i> <strong>{phase.redAccuracy}%</strong>
                                            </span>
                                        ) : null}
                                        {typeof phase.blackAccuracy === 'number' ? (
                                            <span aria-label={`Black accuracy in the ${phase.label.toLowerCase()} ${phase.blackAccuracy}%`}>
                                                <i aria-hidden="true">B</i> <strong>{phase.blackAccuracy}%</strong>
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="review-phase-count">
                                        {phase.moves} {phase.moves === 1 ? 'move' : 'moves'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {narrativeTags.length > 0 ? (
                        <div className="review-narratives" role="group" aria-label="Game summary">
                            {narrativeTags.map(tag => (
                                <span key={tag.id} className={narrativeTagToneClass(tag.tone)} title={tag.title}>
                                    {tag.label}
                                </span>
                            ))}
                        </div>
                    ) : null}

                    <div className="review-quality-breakdown" role="group" aria-label="Review quality breakdown">
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
                                    aria-label={formatReviewEvalChangeLabel(focusMoment)}
                                    title={formatReviewEvalTitle(focusMoment)}
                                >
                                    <span>{formatReviewSide(focusMoment.side)} POV</span>
                                    <strong>{formatReviewEvalScoreForSide(focusMoment.evalBefore, focusMoment.side)}</strong>
                                    <em aria-hidden="true">→</em>
                                    <strong>{formatReviewEvalScoreForSide(focusMoment.evalAfter, focusMoment.side)}</strong>
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
                        <div className="review-moment-heading">
                            <span>Key moments</span>
                            <strong data-testid="review-moment-count">{filteredKeyMoments.length}/{totalKeyMoments}</strong>
                        </div>
                        {totalKeyMoments > 0 ? (
                            <div className="review-moment-filters" role="group" aria-label="Filter review key moments">
                                <select
                                    className="review-moment-filter"
                                    value={momentSideFilter}
                                    onChange={(event) => setMomentSideFilter(event.target.value as ReviewMomentSideFilter)}
                                    aria-label="Filter review moments by side"
                                    data-testid="review-moment-side-filter"
                                >
                                    <option value="all">All sides</option>
                                    <option value="red">Red</option>
                                    <option value="black">Black</option>
                                </select>
                                <select
                                    className="review-moment-filter"
                                    value={momentQualityFilter}
                                    onChange={(event) => setMomentQualityFilter(event.target.value as ReviewMomentQualityFilter)}
                                    aria-label="Filter review moments by severity"
                                    data-testid="review-moment-quality-filter"
                                >
                                    <option value="all">All issues</option>
                                    <option value="blunder">Blunders</option>
                                    <option value="mistake">Mistakes</option>
                                    <option value="inaccuracy">Inaccuracies</option>
                                </select>
                            </div>
                        ) : null}
                    </div>

                    {filteredKeyMoments.length > 0 ? (
                        <div className="review-moment-list">
                            {filteredKeyMoments.map((moment) => (
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
                                        aria-label={`${formatReviewQuality(moment.quality)} review moment, ${moment.side} ply ${moment.ply}, played ${formatUciMove(moment.playedMove)}, swing ${formatSwing(moment.swing)}, ${formatReviewChanceLossLabel(moment)}, ${formatReviewEvalChangeLabel(moment)}${moment.bestMove ? `, engine suggested ${formatUciMove(moment.bestMove)}` : ''}`}
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
                                            aria-label={formatReviewEvalChangeLabel(moment)}
                                            title={formatReviewEvalTitle(moment)}
                                        >
                                            <span>{formatReviewSide(moment.side)} POV</span>
                                            <strong>{formatReviewEvalScoreForSide(moment.evalBefore, moment.side)}</strong>
                                            <em aria-hidden="true">→</em>
                                            <strong>{formatReviewEvalScoreForSide(moment.evalAfter, moment.side)}</strong>
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
                            <p>{totalKeyMoments > 0 ? 'No moments match these filters.' : 'No critical moments in this line. That review came back clean.'}</p>
                        </div>
                    )}
                </>
            ) : null}

            {status === 'idle' ? (
                <div className="empty-state">
                    <p>Run Review analyses every move in the current line.</p>
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

function formatReviewSide(side: ReviewSide) {
    return side === 'red' ? 'Red' : 'Black';
}

function getSidePerspectiveEval(score: number, side: ReviewSide) {
    return side === 'red' ? score : -score;
}

function formatReviewEvalScoreForSide(score: number, side: ReviewSide) {
    return formatReviewEvalScore(getSidePerspectiveEval(score, side));
}

function formatReviewEvalTransition(moment: ReviewKeyMoment) {
    return `${formatReviewEvalScoreForSide(moment.evalBefore, moment.side)} → ${formatReviewEvalScoreForSide(moment.evalAfter, moment.side)}`;
}

function formatReviewEvalChangeLabel(moment: ReviewKeyMoment) {
    return `${formatReviewSide(moment.side)} evaluation changed from ${formatReviewEvalScoreForSide(moment.evalBefore, moment.side)} to ${formatReviewEvalScoreForSide(moment.evalAfter, moment.side)}`;
}

function formatReviewEvalTitle(moment: ReviewKeyMoment) {
    return `${formatReviewSide(moment.side)} POV: ${formatReviewEvalTransition(moment)}`;
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
