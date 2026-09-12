/**
 * Learn from your mistakes: the review's key moments, replayed as questions.
 *
 * The review says which move was a mistake and which move the engine
 * preferred. Reading that is one thing; finding it yourself is what makes it
 * stick, and it is what every chess site's "learn from your mistakes" does:
 * put the position before the mistake on the board, ask for a better move,
 * and say how the attempt compares. This module is the judgement; `App.tsx`
 * owns the board, the engine and the sequence.
 *
 * An attempt is graded on the same scale as the review, because a reader
 * who is told their move is "wrong" while the review would have called it
 * "good" has been told two different things by one app. The engine's own
 * move needs no search to be recognised; anything else waits for the live
 * analysis of the position it reaches.
 */
import {
    type ReviewKeyMoment,
    type ReviewMoveQuality,
    classifyMoveQualityForEval,
    getEvalLossForMove,
    getWinPercentLossForMove,
} from './review';

export type DrillMoment = Pick<ReviewKeyMoment, 'nodeId' | 'moveIndex' | 'ply' | 'side' | 'quality' | 'bestMove' | 'playedMove' | 'evalBefore'>;

export type DrillVerdict =
    /** The engine's own move. */
    | { kind: 'best' }
    /** A move the review would have graded best or good: not the engine's, and not a mistake. */
    | { kind: 'good'; winPercentLoss: number; quality: ReviewMoveQuality }
    /** A move the review would have flagged. */
    | { kind: 'wrong'; winPercentLoss: number; quality: ReviewMoveQuality }
    /** The move from the game, which is the one the question is about. */
    | { kind: 'repeat' }
    /** A finished search could not support a grade. */
    | { kind: 'unavailable'; reason: 'bound' | 'missing' }
    /** The reader asked to be shown the answer. */
    | { kind: 'shown' };

/**
 * The moments worth asking about, in the order the game reached them.
 *
 * The review lists key moments worst-first, which is right for reading and
 * wrong for a drill: a drill walks the game. Only moments with a recorded
 * better move are questions; the rest have nothing to compare an attempt to.
 */
export function orderDrillMoments<T extends DrillMoment>(moments: readonly T[]): T[] {
    return moments
        .filter((moment) => Boolean(moment.bestMove) && moment.bestMove !== moment.playedMove)
        .sort((left, right) => left.moveIndex - right.moveIndex);
}

/**
 * Grade one attempt.
 *
 * Returns null while the attempt still needs an evaluation: a move that is
 * neither the engine's nor the game's has to be searched before it can be
 * graded, and the caller supplies the Red-positive evaluation of the
 * position it reaches once the engine has one.
 */
export function judgeDrillAttempt(
    moment: DrillMoment,
    attemptUci: string,
    evalAfter: number | null
): DrillVerdict | null {
    const attempt = attemptUci.trim().toLowerCase();
    if (attempt === (moment.bestMove ?? '').toLowerCase()) return { kind: 'best' };
    if (attempt === moment.playedMove.toLowerCase()) return { kind: 'repeat' };
    if (evalAfter === null || !Number.isFinite(evalAfter)) return null;

    const swing = getEvalLossForMove(moment.evalBefore, evalAfter, moment.side);
    const quality = classifyMoveQualityForEval(swing, moment.evalBefore, evalAfter, moment.side);
    const winPercentLoss = getWinPercentLossForMove(moment.evalBefore, evalAfter, moment.side);
    if (quality === 'best' || quality === 'good') return { kind: 'good', winPercentLoss, quality };
    return { kind: 'wrong', winPercentLoss, quality };
}

/** A completed search must not turn a bound into a grade or wait forever for a missing score. */
export function judgeCompletedDrillAttempt(
    moment: DrillMoment,
    attemptUci: string,
    evalAfter: number | null,
    hasExactEvaluation: boolean,
): DrillVerdict {
    const finite = evalAfter !== null && Number.isFinite(evalAfter);
    return judgeDrillAttempt(moment, attemptUci, hasExactEvaluation && finite ? evalAfter : null)
        ?? { kind: 'unavailable', reason: finite ? 'bound' : 'missing' };
}

/** Whether a verdict counts as the reader having found a better move. */
export function isDrillSuccess(verdict: DrillVerdict | null): boolean {
    return verdict?.kind === 'best' || verdict?.kind === 'good';
}
