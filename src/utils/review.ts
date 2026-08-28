import { formatUciMove } from './moveNotation';
import { GAME_PHASES, type GamePhase, getMovePhaseForRecord } from './gamePhase';
import type { BoardState } from './xiangqi';

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
    bestMove?: string;
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
    evalAfter: number;
    bestMove?: string;
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
    bestMove?: string;
    quality: ReviewMoveQuality;
    swing: number;
    winPercentLoss?: number;
    reviewNote: string;
}

export interface SavedReviewAnnotation {
    moveIndex: number;
    evalScore?: number;
    bestMove?: string;
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
    const bounded = reportedCentipawnLoss(swing);
    const cpSwing = `${Math.round(bounded)}${bounded < swing ? '+' : ''}cp`;
    if (quality === 'best') {
        return 'Engine-approved move.';
    }
    if (quality === 'good') {
        return `Solid choice. Only ${cpSwing} off the best line.`;
    }
    if (bestMove && bestMove !== playedMove) {
        if (retainedDecisiveAdvantage && isCriticalReviewQuality(quality)) {
            return `Still winning, but ${formatUciMove(bestMove)} kept more of the advantage (${cpSwing}).`;
        }
        const prefix = quality === 'blunder'
            ? 'Big miss.'
            : quality === 'mistake'
                ? 'Missed a stronger continuation.'
                : 'Small slip.';
        return `${prefix} ${formatUciMove(bestMove)} was stronger by ${cpSwing}.`;
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

export function computeReviewArtifacts(
    activeLineNodeIds: string[],
    treeNodes: Record<string, ReviewTreeNodeLike>,
    evalOverrides?: EvalOverrides,
    reviewedAt = Date.now(),
    engine?: ReviewEngineSummary
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

    for (const [moveIndex, nodeId] of activeLineNodeIds.entries()) {
        const node = treeNodes[nodeId];
        const record = node?.record;
        if (!record) continue;

        const overrideEval = getEvalOverride(nodeId, evalOverrides);
        const currentEval = typeof overrideEval === 'number' ? overrideEval : record.evalScore;
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
            bestMove: record.bestMove,
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
                evalAfter: currentEval,
                bestMove: record.bestMove,
                playedMove: record.uci,
                note,
            });
        }
    }

    const accuracy = evaluated > 0 ? Math.round(accuracySum / evaluated) : 0;
    const averageCentipawnLoss = evaluated > 0
        ? Math.round(centipawnLossSum / evaluated)
        : undefined;
    const redAccuracy = sideAccuracy.red.count > 0
        ? Math.round(sideAccuracy.red.sum / sideAccuracy.red.count)
        : undefined;
    const blackAccuracy = sideAccuracy.black.count > 0
        ? Math.round(sideAccuracy.black.sum / sideAccuracy.black.count)
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
