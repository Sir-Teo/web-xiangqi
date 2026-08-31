import { describe, expect, it } from 'vitest';
import { MATE_SCORE_BASE, emptyEvalReading, mateDistanceFromScore, takeEvalReading } from './engineEvalReading';

describe('holding an evaluation against a bound', () => {
    it('starts with nothing to show', () => {
        expect(emptyEvalReading()).toEqual({ score: null, exact: false });
    });

    it('takes a bound when the search has said nothing else', () => {
        // Better than no reading at all -- "at least +150" is information.
        expect(takeEvalReading(emptyEvalReading(), 150, true)).toEqual({ score: 150, exact: false });
    });

    it('takes an exact score over a bound', () => {
        const bounded = takeEvalReading(emptyEvalReading(), 900, true);
        expect(takeEvalReading(bounded, 120, false)).toEqual({ score: 120, exact: true });
    });

    it('refuses a bound once an exact score has arrived', () => {
        const exact = takeEvalReading(emptyEvalReading(), 120, false);
        expect(takeEvalReading(exact, 900, true)).toBe(exact);
    });

    it('still takes a later exact score', () => {
        const exact = takeEvalReading(emptyEvalReading(), 120, false);
        expect(takeEvalReading(exact, 180, false)).toEqual({ score: 180, exact: true });
    });

    it('returns the same object when the reading has not moved', () => {
        const held = takeEvalReading(emptyEvalReading(), 120, false);
        expect(takeEvalReading(held, 120, false)).toBe(held);
    });

    it('does not carry one search-s exactness into the next', () => {
        // The regression this type exists for: the number and the flag are
        // discarded together, so a fresh search starts able to show its bounds.
        const finished = takeEvalReading(emptyEvalReading(), 120, false);
        expect(finished.exact).toBe(true);

        const fresh = emptyEvalReading();
        expect(takeEvalReading(fresh, 150, true)).toEqual({ score: 150, exact: false });
    });
});

describe('reading a mate out of a sentinel score', () => {
    it('gives the distance in moves for either side', () => {
        expect(mateDistanceFromScore(MATE_SCORE_BASE - 3)).toBe(3);
        expect(mateDistanceFromScore(-(MATE_SCORE_BASE - 3))).toBe(-3);
    });

    it('signs the distance the way the score is signed', () => {
        // The documented contract: positive is mate for Red, negative for
        // Black. Nothing verified it, and the one caller today re-derives the
        // sign from the score itself -- so dropping the sign here changed no
        // behaviour and no test. The next caller to trust the signature would
        // have found out the hard way.
        for (const moves of [1, 5, 12]) {
            expect(mateDistanceFromScore(MATE_SCORE_BASE - moves)).toBeGreaterThan(0);
            expect(mateDistanceFromScore(-(MATE_SCORE_BASE - moves))).toBeLessThan(0);
        }
    });

    it('keeps mate-in-zero distinguishable by side', () => {
        // `-0`, not `0`. Black's mate-in-zero reaching the exporter as a plain
        // zero is what wrote it as `#0` and read it back as Red's, so the sign
        // has to survive even when the magnitude does not.
        expect(Object.is(mateDistanceFromScore(-MATE_SCORE_BASE), -0)).toBe(true);
        expect(Object.is(mateDistanceFromScore(MATE_SCORE_BASE), 0)).toBe(true);
    });

    it('says nothing for an ordinary evaluation or a nonsense one', () => {
        expect(mateDistanceFromScore(150)).toBeNull();
        expect(mateDistanceFromScore(-150)).toBeNull();
        expect(mateDistanceFromScore(0)).toBeNull();
        expect(mateDistanceFromScore(Number.NaN)).toBeNull();
        expect(mateDistanceFromScore(Number.POSITIVE_INFINITY)).toBeNull();
    });
});
