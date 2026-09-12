import { describe, expect, it } from 'vitest';
import { MATE_SCORE_BASE } from './engineEvalReading';
import { EVAL_BAR_NEUTRAL_SHARE, describeEvalBar, readEvalBar } from './evalBar';

describe('the eval bar reading', () => {
    it('sits at the middle when the position is level', () => {
        expect(readEvalBar(0)).toEqual({ redShare: 0.5, measured: true });
    });

    it('fills toward red as red gets better and never the other way', () => {
        const shares = [-800, -300, -100, 0, 100, 300, 800].map((cp) => readEvalBar(cp).redShare);
        for (let i = 1; i < shares.length; i += 1) {
            expect(shares[i]).toBeGreaterThan(shares[i - 1]);
        }
    });

    it('reads a mate as pegged rather than overflowing the track', () => {
        const red = readEvalBar(MATE_SCORE_BASE - 3).redShare;
        const black = readEvalBar(-(MATE_SCORE_BASE - 3)).redShare;
        expect(red).toBeGreaterThan(0.99);
        expect(red).toBeLessThanOrEqual(1);
        expect(black).toBeLessThan(0.01);
        expect(black).toBeGreaterThanOrEqual(0);
    });

    it('shows its default rather than a bar of nothing before anything is evaluated', () => {
        expect(readEvalBar(null)).toEqual({ redShare: EVAL_BAR_NEUTRAL_SHARE, measured: false });
        expect(readEvalBar(undefined).measured).toBe(false);
        expect(readEvalBar(Number.NaN).measured).toBe(false);
    });

    it('uses the same curve the review scores on', async () => {
        // The bar and the accuracy figures must not disagree about how good a
        // position is, so this is the review's own function rather than a
        // second opinion about the same evaluation.
        const { getWinningChancePercent } = await import('./review');
        expect(readEvalBar(250).redShare).toBeCloseTo(getWinningChancePercent(250, 'red') / 100, 10);
    });
});

describe('what a screen reader is told', () => {
    it('gives the reading and which way it leans', () => {
        expect(describeEvalBar(250, '+2.5'))
            .toBe('Engine evaluation, Red POV +2.5, red winning chances 72%');
    });

    it('says so plainly when there is nothing to report', () => {
        expect(describeEvalBar(null, null)).toBe('Engine evaluation unavailable');
        expect(describeEvalBar(250, null)).toBe('Engine evaluation unavailable');
    });

    it('describes a bound without converting it into definite winning chances', () => {
        expect(describeEvalBar(250, '+2.5', 'Lower bound, not an exact score'))
            .toBe('Engine evaluation, Red POV +2.5, Lower bound, not an exact score');
        expect(describeEvalBar(-29997, '-M3', 'Upper bound, not an exact score'))
            .toBe('Engine evaluation, Red POV -M3, Upper bound, not an exact score');
        expect(describeEvalBar(null, null, 'Bound, not an exact score'))
            .toBe('Engine evaluation unavailable');
    });
});
