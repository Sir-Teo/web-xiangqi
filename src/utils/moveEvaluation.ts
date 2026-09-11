import { evaluationKindOverride, type EvaluationScoreKind } from './engineEvalReading';
import type { ReviewMoveQuality } from './review';

/** Evaluation after a move, separate from a completed game-review summary. */
export type MoveEvaluation = {
    evalScore?: number;
    evalDepth?: number;
    /** Override the legacy numeric encoding when a large cp score overlaps it. */
    evalScoreKind?: EvaluationScoreKind;
    quality?: ReviewMoveQuality;
};
const qualities: ReviewMoveQuality[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
export function normalizeEvalDepth(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535 ? value : undefined;
}
export function normalizeMoveEvaluation(value: unknown): MoveEvaluation {
    if (!value || typeof value !== 'object') return {};
    const raw = value as MoveEvaluation;
    const evalScore = typeof raw.evalScore === 'number' && Number.isFinite(raw.evalScore)
        && Math.abs(raw.evalScore) <= Number.MAX_SAFE_INTEGER ? raw.evalScore : undefined;
    const evalScoreKind = evalScore !== undefined ? evaluationKindOverride(evalScore, raw.evalScoreKind) : undefined;
    const evalDepth = evalScore !== undefined ? normalizeEvalDepth(raw.evalDepth) : undefined;
    const quality = qualities.includes(raw.quality as ReviewMoveQuality) ? raw.quality : undefined;
    return { ...(evalScoreKind ? { evalScoreKind } : {}), ...(evalScore !== undefined ? { evalScore } : {}), ...(evalDepth !== undefined ? { evalDepth } : {}), ...(quality ? { quality } : {}) };
}

/** A replacement score cannot inherit the previous reading’s depth or kind. */
export function replaceMoveEvaluation<T extends MoveEvaluation>(record: T, evalScore: number, depth?: number, kind?: EvaluationScoreKind): T {
    const evalDepth = normalizeEvalDepth(depth);
    const evalScoreKind = evaluationKindOverride(evalScore, kind);
    return record.evalScore === evalScore && record.evalDepth === evalDepth && record.evalScoreKind === evalScoreKind ? record : { ...record, evalScore, evalDepth, evalScoreKind };
}
