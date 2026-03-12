export const REVIEW_THRESHOLDS = {
    best: 40,
    good: 90,
    inaccuracy: 180,
    mistake: 320,
} as const;

export type ReviewMoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
export type ReviewCriticalQuality = Extract<ReviewMoveQuality, 'inaccuracy' | 'mistake' | 'blunder'>;
export type ReviewSide = 'red' | 'black';

export interface ReviewRecordLike {
    uci: string;
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
    evalBefore: number;
    evalAfter: number;
    bestMove?: string;
    playedMove: string;
    note: string;
}

export interface ReviewSummary {
    totalMoves: number;
    accuracy: number;
    bestCount: number;
    goodCount: number;
    inaccuracyCount: number;
    mistakeCount: number;
    blunderCount: number;
    reviewedAt: number;
    lineSignature: string;
    keyMoments: ReviewKeyMoment[];
}

export interface ReviewAnnotation {
    nodeId: string;
    moveIndex: number;
    evalScore: number;
    bestMove?: string;
    quality: ReviewMoveQuality;
    swing: number;
    reviewNote: string;
}

export interface SavedReviewAnnotation {
    moveIndex: number;
    evalScore?: number;
    bestMove?: string;
    quality?: ReviewMoveQuality;
    swing?: number;
    reviewNote?: string;
}

export interface SavedReviewSnapshot {
    summary: ReviewSummary;
    annotations: SavedReviewAnnotation[];
}

type EvalOverrides = Map<string, number> | Record<string, number> | null | undefined;

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

export function isCriticalReviewQuality(quality: ReviewMoveQuality): quality is ReviewCriticalQuality {
    return quality === 'inaccuracy' || quality === 'mistake' || quality === 'blunder';
}

export function getReviewQualityPriority(quality: ReviewMoveQuality): number {
    switch (quality) {
        case 'blunder':
            return 4;
        case 'mistake':
            return 3;
        case 'inaccuracy':
            return 2;
        case 'good':
            return 1;
        case 'best':
            return 0;
    }
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
}: {
    quality: ReviewMoveQuality;
    bestMove?: string;
    playedMove: string;
    swing: number;
}): string {
    const cpSwing = `${Math.round(swing)}cp`;
    if (quality === 'best') {
        return 'Engine-approved move.';
    }
    if (quality === 'good') {
        return `Solid choice. Only ${cpSwing} off the best line.`;
    }
    if (bestMove && bestMove !== playedMove) {
        const prefix = quality === 'blunder'
            ? 'Big miss.'
            : quality === 'mistake'
                ? 'Missed a stronger continuation.'
                : 'Small slip.';
        return `${prefix} ${bestMove.toUpperCase()} was stronger by ${cpSwing}.`;
    }
    if (quality === 'blunder') {
        return `Major evaluation swing: ${cpSwing}.`;
    }
    if (quality === 'mistake') {
        return `Noticeable drop of ${cpSwing}.`;
    }
    return `Evaluation slipped by ${cpSwing}.`;
}

export function computeReviewArtifacts(
    activeLineNodeIds: string[],
    treeNodes: Record<string, ReviewTreeNodeLike>,
    evalOverrides?: EvalOverrides,
    reviewedAt = Date.now()
): { summary: ReviewSummary; annotations: ReviewAnnotation[] } {
    const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    const annotations: ReviewAnnotation[] = [];
    const keyMoments: ReviewKeyMoment[] = [];
    let evaluated = 0;

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
        const swing = Math.abs(currentEval - parentEval);
        const quality = classifyMoveQuality(swing);
        const note = buildReviewNote({
            quality,
            bestMove: record.bestMove,
            playedMove: record.uci,
            swing,
        });
        const side: ReviewSide = moveIndex % 2 === 0 ? 'red' : 'black';

        counts[quality] += 1;
        annotations.push({
            nodeId,
            moveIndex,
            evalScore: currentEval,
            bestMove: record.bestMove,
            quality,
            swing,
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
                evalBefore: parentEval,
                evalAfter: currentEval,
                bestMove: record.bestMove,
                playedMove: record.uci,
                note,
            });
        }
    }

    const weights = { best: 100, good: 80, inaccuracy: 55, mistake: 30, blunder: 0 };
    const weightedSum =
        counts.best * weights.best +
        counts.good * weights.good +
        counts.inaccuracy * weights.inaccuracy +
        counts.mistake * weights.mistake;
    const accuracy = evaluated > 0 ? Math.round(weightedSum / evaluated) : 0;

    keyMoments.sort((left, right) =>
        getReviewQualityPriority(right.quality) - getReviewQualityPriority(left.quality) ||
        right.swing - left.swing ||
        left.moveIndex - right.moveIndex
    );

    return {
        summary: {
            totalMoves: evaluated,
            accuracy,
            bestCount: counts.best,
            goodCount: counts.good,
            inaccuracyCount: counts.inaccuracy,
            mistakeCount: counts.mistake,
            blunderCount: counts.blunder,
            reviewedAt,
            lineSignature: makeReviewLineSignature(activeLineNodeIds, treeNodes),
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
