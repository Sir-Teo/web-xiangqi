import type { EvaluationScoreKind } from './engineEvalReading';
import { GAME_PHASES, type GamePhase, getMovePhaseForRecord } from './gamePhase';
import { MIN_WEIGHT, aggregateAccuracy, volatilityWeights } from './accuracyAggregate';
import type { BoardState } from './xiangqi';
import { bestLineForMove } from './engineBestLine';

export const REVIEW_THRESHOLDS = {
    best: 40,
    good: 90,
    inaccuracy: 180,
    mistake: 320,
} as const;
export const REVIEW_WIN_PERCENT_LOSS_THRESHOLDS = {
    best: 2,
    good: 5,
    inaccuracy: 20,
    mistake: 30,
} as const;
export const REVIEW_DECISIVE_ADVANTAGE_CP = 600;

export type ReviewMoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type ReviewCriticalQuality = Extract<ReviewMoveQuality, 'inaccuracy' | 'mistake' | 'blunder'>;
export type ReviewSide = 'red' | 'black';
export type ReviewEngineTier = 'low' | 'mid' | 'high';

export interface ReviewRecordLike {
    uci: string;
    piece?: string;
    ply: number;
    evalScore?: number;
    evalScoreKind?: EvaluationScoreKind;
    bestMove?: string;
    /** The engine's line from the parent position; see `utils/engineBestLine`. */
    bestLine?: string[];
}

export interface ReviewTreeNodeLike {
    parentId: string | null;
    record?: ReviewRecordLike;
}

export interface ReviewKeyMoment {
    nodeId: string;
    moveIndex: number;
    jumpTarget: number;
    ply: number;
    side: ReviewSide;
    quality: ReviewCriticalQuality;
    swing: number;
    winPercentLoss?: number;
    evalBefore: number;
    evalBeforeKind?: EvaluationScoreKind;
    evalAfter: number;
    evalAfterKind?: EvaluationScoreKind;
    bestMove?: string;
    /** What the engine would have played on, starting with `bestMove`. */
    bestLine?: string[];
    playedMove: string;
    note: string;
}

export interface ReviewEngineSummary {
    tier: ReviewEngineTier;
    baseDepth: number;
    baseMoveTimeMs: number;
    revisitDepth?: number;
    revisitMoveTimeMs?: number;
}

export interface ReviewSummary {
    totalMoves: number;
    accuracy: number;
    averageCentipawnLoss?: number;
    redAccuracy?: number;
    blackAccuracy?: number;
    redAverageCentipawnLoss?: number;
    blackAverageCentipawnLoss?: number;
    bestCount: number;
    goodCount: number;
    inaccuracyCount: number;
    mistakeCount: number;
    blunderCount: number;
    reviewedAt: number;
    lineSignature: string;
    engine?: ReviewEngineSummary;
    keyMoments: ReviewKeyMoment[];
}

export interface ReviewAnnotation {
    nodeId: string;
    moveIndex: number;
    evalScore: number;
    evalScoreKind?: EvaluationScoreKind;
    bestMove?: string;
    bestLine?: string[];
    quality: ReviewMoveQuality;
    swing: number;
    winPercentLoss?: number;
    reviewNote: string;
}

export interface SavedReviewAnnotation {
    moveIndex: number;
    evalScore?: number;
    evalScoreKind?: EvaluationScoreKind;
    bestMove?: string;
    bestLine?: string[];
    quality?: ReviewMoveQuality;
    swing?: number;
    winPercentLoss?: number;
    reviewNote?: string;
}

export interface SavedReviewSnapshot {
    summary: ReviewSummary;
    annotations: SavedReviewAnnotation[];
}

type EvalOverrides = Map<string, number> | Record<string, number> | null | undefined;
const REVIEW_QUALITY_PRIORITY: Record<ReviewMoveQuality, number> = {
    best: 0,
    good: 1,
    inaccuracy: 2,
    mistake: 3,
    blunder: 4,
};
const WIN_PERCENT_EVAL_SLOPE = 0.00368208;
const WIN_PERCENT_EVAL_LIMIT = 3000;
const MOVE_ACCURACY_SCALE = 103.1668;
const MOVE_ACCURACY_DECAY = 0.04354;
const MOVE_ACCURACY_OFFSET = 3.1669;

export function getEvalOverride(nodeId: string, evalOverrides: EvalOverrides) {
    if (!evalOverrides) return undefined;
    if (evalOverrides instanceof Map) {
        return evalOverrides.get(nodeId);
    }
    return evalOverrides[nodeId];
}

export function classifyMoveQuality(delta: number): ReviewMoveQuality {
    if (delta <= REVIEW_THRESHOLDS.best) return 'best';
    if (delta <= REVIEW_THRESHOLDS.good) return 'good';
    if (delta <= REVIEW_THRESHOLDS.inaccuracy) return 'inaccuracy';
    if (delta <= REVIEW_THRESHOLDS.mistake) return 'mistake';
    return 'blunder';
}

export function classifyWinPercentLoss(loss: number): ReviewMoveQuality {
    if (loss <= REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.best) return 'best';
    if (loss <= REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.good) return 'good';
    if (loss <= REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.inaccuracy) return 'inaccuracy';
    if (loss <= REVIEW_WIN_PERCENT_LOSS_THRESHOLDS.mistake) return 'mistake';
    return 'blunder';
}

export function getEvalForReviewSide(evalScore: number, side: ReviewSide): number {
    return side === 'red' ? evalScore : -evalScore;
}

export function hasDecisiveAdvantageAfterMove(evalAfter: number, side: ReviewSide): boolean {
    return getEvalForReviewSide(evalAfter, side) >= REVIEW_DECISIVE_ADVANTAGE_CP;
}

export function getWinningChancePercent(evalScore: number, side: ReviewSide): number {
    const sideEval = getEvalForReviewSide(evalScore, side);
    const boundedEval = Math.max(-WIN_PERCENT_EVAL_LIMIT, Math.min(WIN_PERCENT_EVAL_LIMIT, sideEval));
    return 100 / (1 + Math.exp(-WIN_PERCENT_EVAL_SLOPE * boundedEval));
}

export function getWinPercentLossForMove(evalBefore: number, evalAfter: number, side: ReviewSide): number {
    const loss = getWinningChancePercent(evalBefore, side) - getWinningChancePercent(evalAfter, side);
    return Math.max(0, loss);
}

/**
 * A number that can be rendered, and a type guard so TypeScript agrees.
 *
 * `typeof x === 'number'` narrows but admits NaN; `Number.isFinite(x)` rejects
 * NaN but does not narrow. Reaching for the first is how a non-finite value
 * gets past a check into a renderer that assumes it has a number -- which is
 * what put "NaN%" on the review panel and, in the eval graph, erased the whole
 * chart. This is both.
 */
export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function clampWinPercentLoss(loss: number): number {
    if (!Number.isFinite(loss)) return 0;
    return Math.max(0, Math.min(100, loss));
}

export function formatWinPercentLoss(loss: number): string {
    const normalized = clampWinPercentLoss(loss);
    if (normalized < 0.05) return '0%';
    const precision = normalized < 10 ? 1 : 0;
    return `-${Number(normalized.toFixed(precision))}%`;
}

export function formatWinPercentLossLabel(loss: number, side: ReviewSide): string {
    const normalized = clampWinPercentLoss(loss);
    const precision = normalized < 10 ? 1 : 0;
    const formattedLoss = `${Number(normalized.toFixed(precision))} percentage points`;
    return `${side === 'red' ? 'Red' : 'Black'} practical winning chance dropped by ${formattedLoss}`;
}

export function getMoveAccuracyForWinPercentLoss(loss: number): number {
    const normalized = clampWinPercentLoss(loss);
    const accuracy = MOVE_ACCURACY_SCALE * Math.exp(-MOVE_ACCURACY_DECAY * normalized) - MOVE_ACCURACY_OFFSET;
    return Math.max(0, Math.min(100, accuracy));
}

function getLessSevereReviewQuality(left: ReviewMoveQuality, right: ReviewMoveQuality): ReviewMoveQuality {
    return REVIEW_QUALITY_PRIORITY[left] <= REVIEW_QUALITY_PRIORITY[right] ? left : right;
}

export function classifyMoveQualityForEval(
    delta: number,
    evalBefore: number,
    evalAfter: number,
    side: ReviewSide
): ReviewMoveQuality {
    const rawQuality = classifyMoveQuality(delta);
    if (!Number.isFinite(evalBefore) || !Number.isFinite(evalAfter)) return rawQuality;
    const practicalLoss = getWinPercentLossForMove(evalBefore, evalAfter, side);
    return getLessSevereReviewQuality(classifyWinPercentLoss(practicalLoss), rawQuality);
}

export function getReviewSideForRecord(record: ReviewRecordLike, moveIndex: number): ReviewSide {
    if (record.piece) {
        return record.piece === record.piece.toUpperCase() ? 'red' : 'black';
    }
    if (Number.isFinite(record.ply)) {
        return record.ply % 2 === 1 ? 'red' : 'black';
    }
    return moveIndex % 2 === 0 ? 'red' : 'black';
}

/**
 * A mate is encoded as a sentinel score (`MATE_SCORE_BASE - mateIn`, 30000) and
 * not as an evaluation, so subtracting it from an ordinary score gives a delta
 * of hundreds of pawns — two different kinds of statement in the same units.
 * One such move took a six-move review to an average loss of 5017.
 *
 * Bounding what gets reported keeps a forced mate at the top of the scale
 * without letting it stand in for the rest of the game. web-chess uses the same
 * bound, from Lichess. Deliberately not applied to the swing itself: move
 * quality reads winning chances, which are bounded already, and the raw swing
 * stays raw for anything that wants it.
 */
export const MAX_REPORTED_CENTIPAWN_LOSS = 1000;

export function reportedCentipawnLoss(swing: number): number {
    if (!Number.isFinite(swing)) return 0;
    return Math.min(MAX_REPORTED_CENTIPAWN_LOSS, Math.max(0, swing));
}

export function getEvalLossForMove(evalBefore: number, evalAfter: number, side: ReviewSide): number {
    const loss = side === 'red'
        ? evalBefore - evalAfter
        : evalAfter - evalBefore;
    return Math.max(0, loss);
}

export function getMoveQualityClassName(quality?: ReviewMoveQuality): string {
    return quality ? `quality-${quality}` : 'quality-pending';
}

/**
 * The quality with the article that fits it, for prose like "the review found
 * an inaccuracy". Only "inaccuracy" of the five words begins with a vowel, and
 * this is a letter test rather than a sound test -- the wrong tool for English
 * in general ("an hour", "a unicorn"), and exactly right for a closed set of
 * five words nobody is going to add "hour" to.
 */
export function formatReviewQualityWithArticle(quality: ReviewMoveQuality): string {
    const word = formatReviewQuality(quality).toLowerCase();
    return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

export function formatReviewQuality(quality: ReviewMoveQuality): string {
    switch (quality) {
        case 'best':
            return 'Best';
        case 'good':
            return 'Good';
        case 'inaccuracy':
            return 'Inaccuracy';
        case 'mistake':
            return 'Mistake';
        case 'blunder':
            return 'Blunder';
    }
}

export function formatReviewCount(count: number, singular: string, plural = `${singular}s`): string {
    const normalized = Math.max(0, Math.trunc(count));
    return `${normalized} ${normalized === 1 ? singular : plural}`;
}

export function formatReviewQualityCount(quality: ReviewMoveQuality, count: number): string {
    switch (quality) {
        case 'best':
            return formatReviewCount(count, 'best move');
        case 'good':
            return formatReviewCount(count, 'good move');
        case 'inaccuracy':
            return formatReviewCount(count, 'inaccuracy', 'inaccuracies');
        case 'mistake':
            return formatReviewCount(count, 'mistake');
        case 'blunder':
            return formatReviewCount(count, 'blunder');
    }
}

export function formatAverageCentipawnLoss(value: number): string {
    if (!Number.isFinite(value)) return 'n/a';
    return `${Math.max(0, Math.round(value))}cp`;
}

export function formatReviewEngineMoveTime(moveTimeMs: number): string {
    if (!Number.isFinite(moveTimeMs) || moveTimeMs <= 0) return 'unknown time';
    if (moveTimeMs < 1000) return `${Math.trunc(moveTimeMs)}ms`;
    const seconds = moveTimeMs / 1000;
    return `${Number(seconds.toFixed(Number.isInteger(seconds) ? 0 : 1))}s`;
}

export function formatReviewEngineSummary(engine?: ReviewEngineSummary): string {
    if (!engine) return 'Previous review';
    const base = `D${engine.baseDepth}/${formatReviewEngineMoveTime(engine.baseMoveTimeMs)}`;
    const revisit = typeof engine.revisitDepth === 'number'
        ? ` · revisit D${engine.revisitDepth}/${formatReviewEngineMoveTime(engine.revisitMoveTimeMs ?? 0)}`
        : '';
    return `${engine.tier} · ${base}${revisit}`;
}

export function describeReviewEngineSummary(engine?: ReviewEngineSummary): string {
    if (!engine) return 'Review engine details unavailable for this saved review';
    const base = `${engine.tier} tier engine, base depth ${engine.baseDepth} for ${formatReviewEngineMoveTime(engine.baseMoveTimeMs)}`;
    if (typeof engine.revisitDepth === 'number') {
        return `${base}, revisit depth ${engine.revisitDepth} for ${formatReviewEngineMoveTime(engine.revisitMoveTimeMs ?? 0)}`;
    }
    return base;
}

export function isCriticalReviewQuality(quality: ReviewMoveQuality): quality is ReviewCriticalQuality {
    return quality === 'inaccuracy' || quality === 'mistake' || quality === 'blunder';
}

export function getReviewQualityPriority(quality: ReviewMoveQuality): number {
    return REVIEW_QUALITY_PRIORITY[quality];
}

/**
 * The moves, and deliberately not the position they were played from.
 *
 * Two lines with the same moves from different roots therefore share a
 * signature, and the freshness check in `App.tsx` would call a review of one
 * current for the other. That is unreachable today because every path that
 * changes the root -- loading a FEN, importing, loading a saved game, a new
 * game, playing on from a position -- calls `resetReview()` first.
 *
 * Written down because it is a coupling rather than a guarantee: a new
 * root-changing path that forgets that call would not fail loudly, it would
 * show one game's accuracy beside another game's board. If that ever happens,
 * the fix is to put the root in here rather than to remember harder.
 */
export function makeReviewLineSignatureFromMoves(moves: string[]): string {
    return moves.join(' ');
}

export function makeReviewLineSignature(
    activeLineNodeIds: string[],
    treeNodes: Record<string, ReviewTreeNodeLike>
): string {
    const moves = activeLineNodeIds
        .map((nodeId) => treeNodes[nodeId]?.record?.uci)
        .filter((uci): uci is string => Boolean(uci));
    return makeReviewLineSignatureFromMoves(moves);
}

export function buildReviewNote({
    quality,
    bestMove,
    playedMove,
    swing,
    retainedDecisiveAdvantage,
}: {
    quality: ReviewMoveQuality;
    bestMove?: string;
    playedMove: string;
    swing: number;
    retainedDecisiveAdvantage?: boolean;
}): string {
    // Bounded like the averages, with a "+" rather than a bound presented as a
    // measurement — a forced mate is genuinely off this scale.
    //
    // The marker asks whether the cap was reached, not whether the bounded
    // value came out below the input. Those differ for an input the guard
    // rejects: `reportedCentipawnLoss` turns a non-finite swing into 0, and
    // `0 < Infinity` is true, so an infinite swing read as "0+cp" — a bound of
    // at least nothing. Not reachable today, since swings come from two bounded
    // evaluations, but the marker should mean what it says.
    const bounded = reportedCentipawnLoss(swing);
    const reachedTheCap = Number.isFinite(swing) && swing > MAX_REPORTED_CENTIPAWN_LOSS;
    const cpSwing = `${Math.round(bounded)}${reachedTheCap ? '+' : ''}cp`;
    if (quality === 'best') {
        return 'Engine-approved move.';
    }
    if (quality === 'good') {
        return `Solid choice. Only ${cpSwing} off the best line.`;
    }
    if (bestMove && bestMove !== playedMove) {
        if (retainedDecisiveAdvantage && isCriticalReviewQuality(quality)) {
            return `Still winning, but the engine line kept more of the advantage (${cpSwing}).`;
        }
        const prefix = quality === 'blunder'
            ? 'Big miss.'
            : quality === 'mistake'
                ? 'Missed a stronger continuation.'
                : 'Small slip.';
        return `${prefix} The engine move was stronger by ${cpSwing}.`;
    }
    if (quality === 'blunder') {
        return `Major evaluation swing: ${cpSwing}.`;
    }
    if (retainedDecisiveAdvantage && isCriticalReviewQuality(quality)) {
        return `Still winning, but evaluation dropped by ${cpSwing}.`;
    }
    if (quality === 'mistake') {
        return `Noticeable drop of ${cpSwing}.`;
    }
    return `Evaluation slipped by ${cpSwing}.`;
}

/**
 * Old saved reviews embedded a coordinate move in their prose. Current notes
 * keep the move in the dedicated, notation-aware suggestion beside the prose;
 * normalize the two historical sentence shapes so loading a saved study does
 * not bring the duplicate coordinates back.
 */
export function formatReviewNoteForDisplay(note: string, bestMove?: string): string {
    if (!bestMove || !/^[a-i][0-9][a-i][0-9]$/i.test(bestMove)) return note;
    const from = bestMove.slice(0, 2);
    const to = bestMove.slice(2, 4);
    const move = `${from}\\s*(?:→|->|[-–—])?\\s*${to}`;
    return note
        .replace(new RegExp(`Still winning, but\\s+${move}\\s+kept`, 'i'), 'Still winning, but the engine line kept')
        .replace(new RegExp(`${move}\\s+was stronger`, 'i'), 'The engine move was stronger');
}

/** One phase's share of a review, in the same terms as the overall summary. */
export interface PhaseAccuracySummary {
    phase: GamePhase;
    label: string;
    accuracy: number;
    redAccuracy?: number;
    blackAccuracy?: number;
    moves: number;
}

/** A record carrying enough to place a move in a phase and score it. */
export interface PhaseAccuracyRecordLike extends ReviewRecordLike {
    board?: BoardState;
    captured?: string;
    winPercentLoss?: number;
}

/**
 * Accuracy split by phase, so a report can say *where* a game was lost rather
 * than only by how much.
 *
 * Scored with the same curve as the overall summary, so the phase figures
 * bracket the overall one instead of telling a different story. Moves with no
 * evaluation are skipped, and a phase with nothing scored is left out
 * altogether — an empty phase would otherwise read as a score of zero.
 */
export function summarizeAccuracyByPhase(
    records: PhaseAccuracyRecordLike[],
    /** Plies played before the line began; see plyOffsetFromRootFen. */
    plyOffset = 0
): PhaseAccuracySummary[] {
    const totals = new Map<GamePhase, { sum: number; count: number; red: { sum: number; count: number }; black: { sum: number; count: number } }>();

    for (const [moveIndex, record] of records.entries()) {
        if (!record?.board || typeof record.winPercentLoss !== 'number') continue;
        const phase = getMovePhaseForRecord({ board: record.board, captured: record.captured }, record.ply + plyOffset);
        const accuracy = getMoveAccuracyForWinPercentLoss(record.winPercentLoss);
        const side = getReviewSideForRecord(record, moveIndex);
        const bucket = totals.get(phase)
            ?? { sum: 0, count: 0, red: { sum: 0, count: 0 }, black: { sum: 0, count: 0 } };
        bucket.sum += accuracy;
        bucket.count += 1;
        bucket[side].sum += accuracy;
        bucket[side].count += 1;
        totals.set(phase, bucket);
    }

    return GAME_PHASES.flatMap(({ key, label }) => {
        const bucket = totals.get(key);
        if (!bucket || bucket.count === 0) return [];
        return [{
            phase: key,
            label,
            accuracy: Math.round(bucket.sum / bucket.count),
            redAccuracy: bucket.red.count > 0 ? Math.round(bucket.red.sum / bucket.red.count) : undefined,
            blackAccuracy: bucket.black.count > 0 ? Math.round(bucket.black.sum / bucket.black.count) : undefined,
            moves: bucket.count,
        }];
    });
}

/** How the key-moment list is narrowed. 'all' for each dimension leaves it alone. */
export interface KeyMomentFilters {
    side: ReviewSide | 'all';
    quality: ReviewCriticalQuality | 'all';
    phase: GamePhase | 'all';
}

/**
 * The key moments left after the panel's filters.
 *
 * Phase is looked up per move rather than stored on the moment, so a review
 * restored from the library filters the same way a fresh one does without
 * anything new having to be persisted.
 */
export function filterKeyMoments(
    moments: ReviewKeyMoment[],
    filters: KeyMomentFilters,
    phaseByMoveIndex: Array<GamePhase | null> = []
): ReviewKeyMoment[] {
    return moments.filter((moment) => {
        if (filters.side !== 'all' && moment.side !== filters.side) return false;
        if (filters.quality !== 'all' && moment.quality !== filters.quality) return false;
        if (filters.phase !== 'all' && phaseByMoveIndex[moment.moveIndex] !== filters.phase) return false;
        return true;
    });
}

/**
 * Which positions a review comes back to at greater depth.
 *
 * The base pass records, per decision point, how much the evaluation swung
 * there. The revisit pass re-examines the worst of them -- the moments the game
 * actually turned on -- because a deeper look at a handful of positions is worth
 * more than a slightly deeper look at all of them.
 *
 * This lived inside the review controller, reading a mutable ref, so the rule
 * could not be exercised without driving the whole component. It is three lines
 * and two decisions: biggest swing first, and no more than the budget allows.
 *
 * Ties keep the order they were recorded in, because `Array.prototype.sort` is
 * stable -- which means two equally bad moments are revisited in the order they
 * were played, not in whatever order a Map happened to yield.
 */
/**
 * Whether a decision point's swing is worth remembering, and at what value.
 *
 * The base pass walks the line and notes, per decision point, how much the
 * evaluation moved there — but only the swings big enough to be worth a second,
 * deeper look, and only the worst one at each point. A decision point can be
 * reached by more than one explored child; the one that cost most is the one
 * that describes it.
 *
 * Returns the value to store, or null to leave what is already there. Both
 * decisions lived inline in the review controller, including the `>=` on the
 * threshold, which is the kind of boundary that is easy to change by accident
 * and hard to notice: a swing exactly on the threshold is worth revisiting.
 */
export function nextCriticalSwing(
    previous: number | undefined,
    swing: number,
    threshold: number
): number | null {
    if (!Number.isFinite(swing) || swing < threshold) return null;
    if (typeof previous === 'number' && swing <= previous) return null;
    return swing;
}

export function selectRevisitNodes(swings: Map<string, number>, limit: number): string[] {
    if (!Number.isFinite(limit) || limit <= 0) return [];

    return Array.from(swings.entries())
        // A non-finite swing has no place in an ordering; dropping it beats
        // letting it sort arbitrarily against everything else.
        .filter(([, swing]) => Number.isFinite(swing))
        .sort((left, right) => right[1] - left[1])
        .slice(0, Math.floor(limit))
        .map(([nodeId]) => nodeId);
}

export function computeReviewArtifacts(
    activeLineNodeIds: string[],
    treeNodes: Record<string, ReviewTreeNodeLike>,
    evalOverrides?: EvalOverrides,
    reviewedAt = Date.now(),
    engine?: ReviewEngineSummary,
    kindOverrides?: ReadonlyMap<string, EvaluationScoreKind | undefined>,
): { summary: ReviewSummary; annotations: ReviewAnnotation[] } {
    const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    const annotations: ReviewAnnotation[] = [];
    const keyMoments: ReviewKeyMoment[] = [];
    let evaluated = 0;
    let accuracySum = 0;
    let centipawnLossSum = 0;
    const sideAccuracy = {
        red: { sum: 0, lossSum: 0, count: 0 },
        black: { sum: 0, lossSum: 0, count: 0 },
    };
    // Per-move accuracies kept in order, plus the winning-chance series they
    // came from, so the game figure can be weighted by how volatile the game
    // was rather than averaged flat. See utils/accuracyAggregate.
    const moveAccuracies: number[] = [];
    const sideMoveAccuracies: Record<ReviewSide, number[]> = { red: [], black: [] };
    const sideWeightIndices: Record<ReviewSide, number[]> = { red: [], black: [] };
    const winPercentSeries: number[] = [];

    for (const [moveIndex, nodeId] of activeLineNodeIds.entries()) {
        const node = treeNodes[nodeId];
        const record = node?.record;
        if (!record) continue;

        const overrideEval = getEvalOverride(nodeId, evalOverrides);
        const currentEval = typeof overrideEval === 'number' ? overrideEval : record.evalScore;
        const currentKind = kindOverrides?.has(nodeId) ? kindOverrides.get(nodeId) : record.evalScoreKind;
        const parentKind = node.parentId
            ? (kindOverrides?.has(node.parentId) ? kindOverrides.get(node.parentId) : treeNodes[node.parentId]?.record?.evalScoreKind)
            : undefined;
        /**
         * The `: 0` here is unreachable, as it was in the move tree and in the
         * board's last-move arrow, where it left the first move of every game
         * ungraded: a root id is a truthy string, so the lookup always runs and
         * the root holds no record.
         *
         * It does not bite here, and the reason is worth knowing before anyone
         * "fixes" it. A review queues `[rootNodeId, ...activeLineNodeIds]`, so
         * the root position is searched first and its score arrives as an
         * override keyed by the root's id. The first move therefore has a real
         * parent evaluation -- the engine's opinion of the start, not an
         * assumed zero -- which is better than what the other two sites can do.
         * `test-review-calibration.cjs` asserts the buckets add up to the whole
         * game, so a first move dropped here would fail it.
         */
        const parentOverride = node.parentId ? getEvalOverride(node.parentId, evalOverrides) : undefined;
        const parentEval = node.parentId
            ? (typeof parentOverride === 'number' ? parentOverride : treeNodes[node.parentId]?.record?.evalScore)
            : 0;

        if (typeof currentEval !== 'number' || typeof parentEval !== 'number') continue;

        evaluated += 1;
        const side = getReviewSideForRecord(record, moveIndex);
        const swing = getEvalLossForMove(parentEval, currentEval, side);
        const winPercentLoss = getWinPercentLossForMove(parentEval, currentEval, side);
        const retainedDecisiveAdvantage = hasDecisiveAdvantageAfterMove(currentEval, side);
        const quality = classifyMoveQualityForEval(swing, parentEval, currentEval, side);
        const moveAccuracy = getMoveAccuracyForWinPercentLoss(winPercentLoss);
        accuracySum += moveAccuracy;
        if (winPercentSeries.length === 0) winPercentSeries.push(getWinningChancePercent(parentEval, 'red'));
        winPercentSeries.push(getWinningChancePercent(currentEval, 'red'));
        sideWeightIndices[side].push(moveAccuracies.length);
        moveAccuracies.push(moveAccuracy);
        sideMoveAccuracies[side].push(moveAccuracy);
        const reportedLoss = reportedCentipawnLoss(swing);
        centipawnLossSum += reportedLoss;
        sideAccuracy[side].sum += moveAccuracy;
        sideAccuracy[side].lossSum += reportedLoss;
        sideAccuracy[side].count += 1;
        const note = buildReviewNote({
            quality,
            bestMove: record.bestMove,
            playedMove: record.uci,
            swing,
            retainedDecisiveAdvantage,
        });

        counts[quality] += 1;
        annotations.push({
            nodeId,
            moveIndex,
            evalScore: currentEval,
            ...(currentKind ? { evalScoreKind: currentKind } : {}),
            bestMove: record.bestMove,
            bestLine: bestLineForMove(record.bestMove, record.bestLine),
            quality,
            swing,
            winPercentLoss,
            reviewNote: note,
        });

        if (isCriticalReviewQuality(quality)) {
            keyMoments.push({
                nodeId,
                moveIndex,
                jumpTarget: moveIndex,
                ply: record.ply,
                side,
                quality,
                swing,
                winPercentLoss,
                evalBefore: parentEval,
                ...(parentKind ? { evalBeforeKind: parentKind } : {}),
                evalAfter: currentEval,
                ...(currentKind ? { evalAfterKind: currentKind } : {}),
                bestMove: record.bestMove,
                bestLine: bestLineForMove(record.bestMove, record.bestLine),
                playedMove: record.uci,
                note,
            });
        }
    }

    // Volatility-weighted, then averaged with the harmonic mean. The plain
    // mean is what Lichess's own documentation -- the source of the per-move
    // curve above -- says not to use: one blunder in an even game is diluted by
    // fifty quiet moves, and fifty quiet moves in a decided game are scored as
    // though the player had to find them. web-katrain weights by position
    // difficulty for the same reason, from the other direction.
    const weights = volatilityWeights(winPercentSeries);
    const sideWeights = (side: ReviewSide) => sideWeightIndices[side].map((index) => weights[index] ?? MIN_WEIGHT);
    const accuracy = evaluated > 0
        ? Math.round(aggregateAccuracy(moveAccuracies, weights) ?? accuracySum / evaluated)
        : 0;
    const averageCentipawnLoss = evaluated > 0
        ? Math.round(centipawnLossSum / evaluated)
        : undefined;
    const redAccuracy = sideAccuracy.red.count > 0
        ? Math.round(aggregateAccuracy(sideMoveAccuracies.red, sideWeights('red')) ?? sideAccuracy.red.sum / sideAccuracy.red.count)
        : undefined;
    const blackAccuracy = sideAccuracy.black.count > 0
        ? Math.round(aggregateAccuracy(sideMoveAccuracies.black, sideWeights('black')) ?? sideAccuracy.black.sum / sideAccuracy.black.count)
        : undefined;
    const redAverageCentipawnLoss = sideAccuracy.red.count > 0
        ? Math.round(sideAccuracy.red.lossSum / sideAccuracy.red.count)
        : undefined;
    const blackAverageCentipawnLoss = sideAccuracy.black.count > 0
        ? Math.round(sideAccuracy.black.lossSum / sideAccuracy.black.count)
        : undefined;

    keyMoments.sort((left, right) =>
        getReviewQualityPriority(right.quality) - getReviewQualityPriority(left.quality) ||
        right.swing - left.swing ||
        left.moveIndex - right.moveIndex
    );

    return {
        summary: {
            totalMoves: evaluated,
            accuracy,
            averageCentipawnLoss,
            redAccuracy,
            blackAccuracy,
            redAverageCentipawnLoss,
            blackAverageCentipawnLoss,
            bestCount: counts.best,
            goodCount: counts.good,
            inaccuracyCount: counts.inaccuracy,
            mistakeCount: counts.mistake,
            blunderCount: counts.blunder,
            reviewedAt,
            lineSignature: makeReviewLineSignature(activeLineNodeIds, treeNodes),
            engine,
            keyMoments,
        },
        annotations,
    };
}

export function remapReviewSummaryToLine(
    summary: ReviewSummary,
    activeLineNodeIds: string[]
): ReviewSummary {
    return {
        ...summary,
        keyMoments: summary.keyMoments
            .map((moment) => {
                const nodeId = activeLineNodeIds[moment.moveIndex];
                if (!nodeId) return null;
                return { ...moment, nodeId };
            })
            .filter((moment): moment is ReviewKeyMoment => Boolean(moment)),
    };
}

/**
 * Rebuilds the derived half of a summary from the per-move annotations saved
 * beside it.
 *
 * This repo is the only one of the three that stores a conclusion rather than
 * the evidence for it: web-katrain recomputes its report from the tree, and
 * web-chess rebuilds a review from the evaluations in the PGN every time. That
 * is why this is the only one that needed a read-path clamp when the centipawn
 * bound landed, and the only one where changing the grading strands the records
 * already saved. `docs/architecture.md` names the fix; this is it.
 *
 * Everything reported except `reviewedAt`, `lineSignature`, `engine` and the
 * key moments is a function of the annotations, so those four are carried over
 * from the stored summary and the rest is recomputed. A summary written before
 * a scoring change therefore reads on the current scale instead of sorting and
 * averaging beside summaries that used a different one.
 */
/** Who moved first in a saved game: the side the root FEN names, Red by default. */
export function reviewSideFromStartFen(startFen?: string): ReviewSide {
    return String(startFen ?? '').trim().split(/\s+/)[1] === 'b' ? 'black' : 'red';
}

export function rebuildSummaryFromAnnotations(
    annotations: SavedReviewAnnotation[],
    stored: ReviewSummary,
    /**
     * The side that played the first annotated move. A saved annotation
     * carries no piece, so the side has to come from the position the game
     * began in: a study set up with Black to move used to have its Red and
     * Black accuracies swapped on every read, because the rebuild assumed
     * the first move was Red's.
     */
    firstMover: ReviewSide = 'red'
): ReviewSummary {
    const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    const side = {
        red: { lossSum: 0, count: 0 },
        black: { lossSum: 0, count: 0 },
    };
    const accuracies: number[] = [];
    const sideAccuracies: Record<ReviewSide, number[]> = { red: [], black: [] };
    const sideIndices: Record<ReviewSide, number[]> = { red: [], black: [] };
    const series: number[] = [];

    for (const annotation of annotations) {
        if (typeof annotation.winPercentLoss !== 'number' || typeof annotation.evalScore !== 'number') {
            // An annotation without the evidence cannot contribute to a figure
            // derived from it; the stored summary stays authoritative below.
            return stored;
        }
        if (annotation.quality) counts[annotation.quality] += 1;

        const evenMove = annotation.moveIndex % 2 === 0;
        const who: ReviewSide = evenMove === (firstMover === 'red') ? 'red' : 'black';
        if (series.length === 0) series.push(getWinningChancePercent(0, 'red'));
        series.push(getWinningChancePercent(annotation.evalScore, 'red'));

        sideIndices[who].push(accuracies.length);
        const accuracy = getMoveAccuracyForWinPercentLoss(annotation.winPercentLoss);
        accuracies.push(accuracy);
        sideAccuracies[who].push(accuracy);
        side[who].lossSum += reportedCentipawnLoss(annotation.swing ?? 0);
        side[who].count += 1;
    }

    const evaluated = side.red.count + side.black.count;
    if (evaluated === 0) return stored;

    const weights = volatilityWeights(series);
    const weightsFor = (who: ReviewSide) => sideIndices[who].map((index) => weights[index] ?? MIN_WEIGHT);
    const round = (value: number | null | undefined) =>
        typeof value === 'number' ? Math.round(value) : undefined;

    return {
        ...stored,
        totalMoves: evaluated,
        accuracy: round(aggregateAccuracy(accuracies, weights)) ?? stored.accuracy,
        averageCentipawnLoss: Math.round((side.red.lossSum + side.black.lossSum) / evaluated),
        redAccuracy: side.red.count ? round(aggregateAccuracy(sideAccuracies.red, weightsFor('red'))) : undefined,
        blackAccuracy: side.black.count ? round(aggregateAccuracy(sideAccuracies.black, weightsFor('black'))) : undefined,
        redAverageCentipawnLoss: side.red.count ? Math.round(side.red.lossSum / side.red.count) : undefined,
        blackAverageCentipawnLoss: side.black.count ? Math.round(side.black.lossSum / side.black.count) : undefined,
        bestCount: counts.best,
        goodCount: counts.good,
        inaccuracyCount: counts.inaccuracy,
        mistakeCount: counts.mistake,
        blunderCount: counts.blunder,
    };
}

/**
 * How far a running review has got, in the units it actually counts.
 *
 * A review searches one position per move plus the starting position, so the
 * total is `moves + 1` and the unit is positions rather than moves — calling
 * it moves would be off by one, and on a long game the reader is watching the
 * number to work out how long this will take.
 *
 * A percentage on its own says nothing about the scale, and the scale is the
 * point: at roughly a second a position, a 240-move game is nearly four
 * minutes of waiting. Returns null when there is no scale to report.
 */
export function formatReviewProgressDetail(completed: number, total: number): string | null {
    if (!Number.isFinite(total) || total <= 0) return null;
    const cap = Math.floor(total);
    const done = Math.min(cap, Math.max(0, Math.floor(Number.isFinite(completed) ? completed : 0)));
    return `${done} of ${cap} ${cap === 1 ? 'position' : 'positions'}`;
}
