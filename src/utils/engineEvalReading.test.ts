import { describe, expect, it } from 'vitest';
import { MATE_SCORE_BASE, formatEvaluationText, mateDistanceFromScore } from './engineEvalReading';

describe('formatEvaluationText', () => {
    it('writes an ordinary evaluation in pawns', () => {
        expect(formatEvaluationText(0)).toBe('0.00');
        expect(formatEvaluationText(150)).toBe('+1.50');
        expect(formatEvaluationText(-275)).toBe('-2.75');
    });

    it('honours the requested precision', () => {
        expect(formatEvaluationText(150, 1)).toBe('+1.5');
    });

    /**
     * The defect this function exists for: the graph, the review panel and the
     * library each divided the mate sentinel by a hundred and printed the
     * result as pawns, so a mate in 15 read as three hundred pawns while the
     * eval bar beside it read `+M15` for the same position.
     */
    it('names a mate rather than dividing its sentinel by a hundred', () => {
        expect(formatEvaluationText(MATE_SCORE_BASE - 15)).toBe('+M15');
        expect(formatEvaluationText(-(MATE_SCORE_BASE - 15))).toBe('-M15');
        expect(formatEvaluationText(MATE_SCORE_BASE - 15)).not.toBe('+299.85');
    });

    /**
     * Guards the assertion above against passing for the wrong reason: the
     * sentinel really is 299.85 pawns on the arithmetic the old code used, so
     * the test would still pass if the sentinel had merely moved.
     */
    it('is reading the same number the old code turned into 299.85', () => {
        expect(((MATE_SCORE_BASE - 15) / 100).toFixed(2)).toBe('299.85');
        expect(mateDistanceFromScore(MATE_SCORE_BASE - 15)).toBe(15);
    });

    /** `${-0}` is "0", so black mating on the move must take its sign from the score. */
    it('keeps the side right for a mate in zero', () => {
        expect(formatEvaluationText(MATE_SCORE_BASE)).toBe('+M0');
        expect(formatEvaluationText(-MATE_SCORE_BASE)).toBe('-M0');
    });

    it('leaves a non-finite reading to the caller', () => {
        expect(formatEvaluationText(Number.NaN)).toBeNull();
        expect(formatEvaluationText(Number.POSITIVE_INFINITY)).toBeNull();
    });

    /** An evaluation a real search can reach is not a mate, however large. */
    it('does not mistake a decisive evaluation for a mate', () => {
        expect(formatEvaluationText(2500)).toBe('+25.00');
    });
});
