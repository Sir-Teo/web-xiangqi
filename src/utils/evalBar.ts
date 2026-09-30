import { getWinningChancePercent } from './review';

/** Red's share of a normalized advantage indicator, using the review's sigmoid.
 * This centipawn transform is a heuristic, not calibrated Xiangqi win probability.
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
export function describeEvalBar(evalScore: number | null | undefined, evalText: string | null, boundText?: string): string {
    const { redShare, measured } = readEvalBar(evalScore);
    if (!measured || !evalText) return 'Engine evaluation unavailable';
    if (boundText) return `Engine evaluation, Red POV ${evalText}, ${boundText}`;
    const redPercent = Math.round(redShare * 100);
    return `Engine evaluation, Red POV ${evalText}, red advantage indicator ${redPercent} out of 100`;
}
