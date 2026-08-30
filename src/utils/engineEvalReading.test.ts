import { describe, expect, it } from 'vitest';
import { emptyEvalReading, takeEvalReading } from './engineEvalReading';

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
