import { getWinningChancePercent } from './review';

/**
 * How much of the eval bar belongs to red.
 *
 * The bar is a *winning chance*, not a centipawn scale, for the same reason the
 * review scores on winning chances: a linear centipawn bar spends most of its
 * length on differences nobody can act on. Two pawns up and five pawns up are a
 * world apart on a linear scale and the same won game in practice. This is the
 * Lichess sigmoid, and it is already the curve every accuracy figure in the app
 * is derived through, so the bar and the review cannot disagree about how good
 * a position is.
 *
 * A mate needs no special case: `getWinningChancePercent` bounds the evaluation
 * before taking a chance, so the sentinel mate score pegs the bar at the end of
 * its travel rather than overflowing it.
 */
export const EVAL_BAR_NEUTRAL_SHARE = 0.5;

export interface EvalBarReading {
    /** Red's share of the bar, 0 to 1. */
    redShare: number;
    /** False when nothing has been evaluated and the bar is showing its default. */
    measured: boolean;
}

export function readEvalBar(evalScore: number | null | undefined): EvalBarReading {
    if (typeof evalScore !== 'number' || !Number.isFinite(evalScore)) {
        return { redShare: EVAL_BAR_NEUTRAL_SHARE, measured: false };
    }
    const percent = getWinningChancePercent(evalScore, 'red');
    // The sigmoid cannot leave 0..100, but it is read off a value that arrives
    // from the engine, and a bar that renders at -4% is a broken bar rather
    // than a wrong one.
    return { redShare: Math.max(0, Math.min(1, percent / 100)), measured: true };
}

/**
 * What a screen reader is told, which is the same three facts the bar shows:
 * whose evaluation it is, what it reads, and which way it is leaning.
 */
export function describeEvalBar(evalScore: number | null | undefined, evalText: string | null): string {
    const { redShare, measured } = readEvalBar(evalScore);
    if (!measured || !evalText) return 'Engine evaluation unavailable';
    const redPercent = Math.round(redShare * 100);
    return `Engine evaluation, Red POV ${evalText}, red winning chances ${redPercent}%`;
}
