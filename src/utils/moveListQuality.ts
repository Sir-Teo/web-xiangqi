import { classifyMoveQualityForEval, getEvalLossForMove, getReviewSideForRecord, isFiniteNumber,
    type ReviewMoveQuality, type ReviewRecordLike } from './review';

/** Saved annotations take precedence; an estimate needs both position scores. */
export function getMoveListQuality(
    record: (ReviewRecordLike & { quality?: ReviewMoveQuality }) | undefined,
    parentEval?: number,
): ReviewMoveQuality | undefined {
    if (record?.quality) return record.quality;
    if (!record || !isFiniteNumber(record.evalScore) || !isFiniteNumber(parentEval)) return undefined;
    const side = getReviewSideForRecord(record, record.ply - 1);
    return classifyMoveQualityForEval(getEvalLossForMove(parentEval, record.evalScore, side), parentEval, record.evalScore, side);
}
