import type { ReviewMoveQuality } from './review';

/** Evaluation after a move, separate from a completed game-review summary. */
export type MoveEvaluation = { evalScore?: number; evalDepth?: number; quality?: ReviewMoveQuality };
const qualities: ReviewMoveQuality[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
export function normalizeEvalDepth(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535 ? value : undefined;
}
export function normalizeMoveEvaluation(value: unknown): MoveEvaluation {
    if (!value || typeof value !== 'object') return {};
    const raw = value as MoveEvaluation;
    const evalScore = typeof raw.evalScore === 'number' && Number.isFinite(raw.evalScore)
        && Math.abs(raw.evalScore) <= Number.MAX_SAFE_INTEGER ? raw.evalScore : undefined;
    const evalDepth = evalScore !== undefined ? normalizeEvalDepth(raw.evalDepth) : undefined;
    const quality = qualities.includes(raw.quality as ReviewMoveQuality) ? raw.quality : undefined;
    return { ...(evalScore !== undefined ? { evalScore } : {}), ...(evalDepth !== undefined ? { evalDepth } : {}), ...(quality ? { quality } : {}) };
}

/** A new search cannot inherit the depth supplied with a previous evaluation. */
export function replaceMoveEvaluation<T extends MoveEvaluation>(record: T, evalScore: number, depth?: number): T {
    const evalDepth = normalizeEvalDepth(depth);
    return record.evalScore === evalScore && record.evalDepth === evalDepth ? record : { ...record, evalScore, evalDepth };
}
