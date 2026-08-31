import { memo, useEffect, useMemo, useState } from 'react';
import type { ReviewStatus } from '../../hooks/useGameReview';
import type { PhaseAccuracySummary, ReviewKeyMoment, ReviewSide, ReviewSummary } from '../../utils/review';
import type { GamePhase } from '../../utils/gamePhase';
import { type NarrativeTag, narrativeTagToneClass } from '../../utils/narrativeTags';
import {
    describeReviewEngineSummary,
    formatWinPercentLoss,
    formatWinPercentLossLabel,
    formatReviewEngineSummary,
    filterKeyMoments,
    formatReviewQuality,
    formatReviewQualityCount,
    formatAverageCentipawnLoss,
    getWinPercentLossForMove,
    getMoveQualityClassName,
    isFiniteNumber,
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
    /** The phase each move belongs to, by move index. Empty before a review. */
    phaseByMoveIndex?: Array<GamePhase | null>;
    currentNodeId: string;
    canStart: boolean;
    startLabel?: string;
    startTitle?: string;
    onStart: () => void;
    onCancel: () => void;
    onClear: () => void;
    onNavigateNode: (nodeId: string) => void;
    onPlayBestMove?: (nodeId: string, bestMove: string) => void;
    /**
     * Writes one move of the reviewed line in the notation the reader chose.
     * A key moment carries move ids, not boards, and WXF and Chinese both need
     * the position the move was played in -- so the caller, which holds the
     * tree, does the lookup. Defaults to coordinates.
     */
    formatMoveText?: (nodeId: string, uci: string) => string;
};

type ReviewMomentSideFilter = 'all' | 'red' | 'black';
type ReviewMomentQualityFilter = 'all' | 'inaccuracy' | 'mistake' | 'blunder';

export const ReviewPanel = memo(function ReviewPanel({
    status,
    progress,
    narrativeTags = [],
    phaseAccuracy = [],
    phaseByMoveIndex = [],
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
    formatMoveText = (_nodeId, uci) => formatUciMove(uci),
}: Props) {
    const [momentSideFilter, setMomentSideFilter] = useState<ReviewMomentSideFilter>('all');
    const [momentQualityFilter, setMomentQualityFilter] = useState<ReviewMomentQualityFilter>('all');
    const [momentPhaseFilter, setMomentPhaseFilter] = useState<GamePhase | 'all'>('all');
    useEffect(() => {
        setMomentSideFilter('all');
        setMomentQualityFilter('all');
        setMomentPhaseFilter('all');
    }, [status, summary?.lineSignature, summary?.reviewedAt]);

    const progressPercent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    const focusMoment = summary?.keyMoments[0] ?? null;
    const reviewEngineLabel = formatReviewEngineSummary(summary?.engine);
    const reviewEngineDetail = `Review engine: ${describeReviewEngineSummary(summary?.engine)}`;
    const averageLossLabel = isFiniteNumber(summary?.averageCentipawnLoss)
        ? `Average centipawn loss ${formatAverageCentipawnLoss(summary.averageCentipawnLoss)}`
        : '';
    const sideAccuracyBreakdown = summary ? [
        { key: 'red', label: 'Red', value: summary.redAccuracy, loss: summary.redAverageCentipawnLoss },
        { key: 'black', label: 'Black', value: summary.blackAccuracy, loss: summary.blackAverageCentipawnLoss },
    // `typeof x === 'number'` admits NaN, which is how a bad figure reaches a
    // renderer that assumes it has a number.
    ].filter((item): item is { key: 'red' | 'black'; label: string; value: number; loss: number | undefined } => isFiniteNumber(item.value)) : [];
    const qualityBreakdown = summary ? [
        { key: 'best', label: 'Best', count: summary.bestCount },
        { key: 'good', label: 'Good', count: summary.goodCount },
        { key: 'inaccuracy', label: 'Inaccuracy', count: summary.inaccuracyCount },
        { key: 'mistake', label: 'Mistake', count: summary.mistakeCount },
        { key: 'blunder', label: 'Blunder', count: summary.blunderCount },
    ] as const : [];
    const filteredKeyMoments = useMemo(() => {
        if (!summary) return [];
        return filterKeyMoments(
            summary.keyMoments,
            { side: momentSideFilter, quality: momentQualityFilter, phase: momentPhaseFilter },
            phaseByMoveIndex,
        );
    }, [momentQualityFilter, momentSideFilter, momentPhaseFilter, phaseByMoveIndex, summary]);
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
                            <strong>{formatAccuracyPercent(summary.accuracy)}</strong>
                        </div>
                        {isFiniteNumber(summary.averageCentipawnLoss) ? (
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
                                aria-label={`${item.label} accuracy ${formatAccuracyPercent(item.value)}${isFiniteNumber(item.loss) ? `, average centipawn loss ${formatAverageCentipawnLoss(item.loss)}` : ''}`}
                                title={`${item.label} accuracy ${formatAccuracyPercent(item.value)}${isFiniteNumber(item.loss) ? `, average centipawn loss ${formatAverageCentipawnLoss(item.loss)}` : ''}`}
                            >
                                <span>{item.label}</span>
                                <strong>{item.value}%</strong>
                                {isFiniteNumber(item.loss) ? (
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
                                <button
                                    key={phase.phase}
                                    type="button"
                                    className={`review-phase-row${momentPhaseFilter === phase.phase ? ' selected' : ''}`}
                                    aria-pressed={momentPhaseFilter === phase.phase}
                                    title={momentPhaseFilter === phase.phase
                                        ? 'Show key moments from the whole game again'
                                        : `Show only key moments from the ${phase.label.toLowerCase()}`}
                                    onClick={() => setMomentPhaseFilter(
                                        momentPhaseFilter === phase.phase ? 'all' : phase.phase
                                    )}
                                >
                                    <span className="review-phase-label">{phase.label}</span>
                                    <span className="review-phase-scores">
                                        {isFiniteNumber(phase.redAccuracy) ? (
                                            <span aria-label={`Red accuracy in the ${phase.label.toLowerCase()} ${phase.redAccuracy}%`}>
                                                <i aria-hidden="true">R</i> <strong>{phase.redAccuracy}%</strong>
                                            </span>
                                        ) : null}
                                        {isFiniteNumber(phase.blackAccuracy) ? (
                                            <span aria-label={`Black accuracy in the ${phase.label.toLowerCase()} ${phase.blackAccuracy}%`}>
                                                <i aria-hidden="true">B</i> <strong>{phase.blackAccuracy}%</strong>
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="review-phase-count">
                                        {phase.moves} {phase.moves === 1 ? 'move' : 'moves'}
                                    </span>
                                </button>
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
                                    <em>Try {formatMoveText(focusMoment.nodeId, focusMoment.bestMove)}</em>
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
                                        aria-label={`${formatReviewQuality(moment.quality)} review moment, ${moment.side} ply ${moment.ply}, played ${formatMoveText(moment.nodeId, moment.playedMove)}, swing ${formatSwing(moment.swing)}, ${formatReviewChanceLossLabel(moment)}, ${formatReviewEvalChangeLabel(moment)}${moment.bestMove ? `, engine suggested ${formatMoveText(moment.nodeId, moment.bestMove)}` : ''}`}
                                    >
                                        <div className="review-moment-topline">
                                            <span>{formatReviewQuality(moment.quality)}</span>
                                            <strong>{moment.side} · ply {moment.ply}</strong>
                                        </div>
                                        <div className="review-moment-main">
                                            <span>{formatMoveText(moment.nodeId, moment.playedMove)}</span>
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
                                            <em>Best: {formatMoveText(moment.nodeId, moment.bestMove)}</em>
                                        ) : null}
                                    </button>
                                    {moment.bestMove && onPlayBestMove ? (
                                        <button
                                            type="button"
                                            className="review-best-move-btn"
                                            onClick={() => onPlayBestMove(moment.nodeId, moment.bestMove!)}
                                            data-testid={`review-try-best-${moment.moveIndex}`}
                                            aria-label={`Try engine suggestion ${formatMoveText(moment.nodeId, moment.bestMove)} instead of ${formatMoveText(moment.nodeId, moment.playedMove)}`}
                                        >
                                            Try best <strong>{formatMoveText(moment.nodeId, moment.bestMove)}</strong>
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
    // Every other number on this panel says "n/a" rather than rendering a
    // non-finite one. This one did not, and put "NaNcp" on the card and into
    // its aria-label.
    if (!Number.isFinite(swing)) return 'n/a';
    return `${Math.round(swing)}cp`;
}

/**
 * An accuracy percentage, which was rendered raw.
 *
 * `{summary.accuracy}%` puts "NaN%" on screen for a summary whose arithmetic
 * went wrong upstream. Every figure here is derived through
 * `clampWinPercentLoss`, which returns 0 for anything non-finite, so this
 * should not happen -- but "should not happen" is what the eval graph's blank
 * chart was, too.
 */
function formatAccuracyPercent(accuracy: number): string {
    if (!Number.isFinite(accuracy)) return 'n/a';
    return `${accuracy}%`;
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
    return isFiniteNumber(moment.winPercentLoss)
        ? Math.max(0, Math.min(100, moment.winPercentLoss))
        : getWinPercentLossForMove(moment.evalBefore, moment.evalAfter, moment.side);
}

function formatReviewChanceLoss(moment: ReviewKeyMoment) {
    return formatWinPercentLoss(getMomentWinPercentLoss(moment));
}

function formatReviewChanceLossLabel(moment: ReviewKeyMoment) {
    return formatWinPercentLossLabel(getMomentWinPercentLoss(moment), moment.side);
}
