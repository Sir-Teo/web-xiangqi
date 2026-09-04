import { describe, expect, it } from 'vitest';
import {
    MAX_BEST_LINE_PLIES,
    bestLineForMove,
    isBestLineWorthShowing,
    normalizeBestLine,
} from './engineBestLine';

describe('normalizeBestLine', () => {
    it('keeps a line of moves as moves', () => {
        expect(normalizeBestLine(['b2e2', 'h9g7', 'h0g2'])).toEqual(['b2e2', 'h9g7', 'h0g2']);
    });

    it('lower-cases, so a stored line compares with a played one', () => {
        expect(normalizeBestLine(['B2E2', 'H9G7'])).toEqual(['b2e2', 'h9g7']);
    });

    it('treats no line and an empty line as the same absence', () => {
        expect(normalizeBestLine([])).toBeUndefined();
        expect(normalizeBestLine(undefined)).toBeUndefined();
        expect(normalizeBestLine('b2e2')).toBeUndefined();
        expect(normalizeBestLine(null)).toBeUndefined();
    });

    /**
     * Stops at the first thing that is not a move rather than filtering it out:
     * a line with a hole in it is not a line, and the moves after the hole no
     * longer follow the ones before.
     */
    it('stops at the first token that is not a move', () => {
        expect(normalizeBestLine(['b2e2', 'h9g7', 'ponder', 'h0g2'])).toEqual(['b2e2', 'h9g7']);
        expect(normalizeBestLine(['z9z9', 'b2e2'])).toBeUndefined();
        expect(normalizeBestLine([{ uci: 'b2e2' }])).toBeUndefined();
    });

    it('bounds what it stores per move', () => {
        const long = Array.from({ length: MAX_BEST_LINE_PLIES + 8 }, () => 'b2e2');
        expect(normalizeBestLine(long)).toHaveLength(MAX_BEST_LINE_PLIES);
    });
});

describe('bestLineForMove', () => {
    it('pairs a line with the move it starts from', () => {
        expect(bestLineForMove('b2e2', ['b2e2', 'h9g7'])).toEqual(['b2e2', 'h9g7']);
        expect(bestLineForMove('B2E2', ['b2e2', 'h9g7'])).toEqual(['b2e2', 'h9g7']);
    });

    /**
     * The guard that matters: the PV and the recorded best move come from the
     * same search, and if they ever disagree they came from different ones --
     * which would put one search's continuation under another's recommendation.
     */
    it('refuses a line that does not begin with the recommended move', () => {
        expect(bestLineForMove('b0c2', ['b2e2', 'h9g7'])).toBeUndefined();
    });

    it('has nothing to pair when there is no recommendation', () => {
        expect(bestLineForMove(undefined, ['b2e2', 'h9g7'])).toBeUndefined();
        expect(bestLineForMove('b2e2', undefined)).toBeUndefined();
    });
});

describe('isBestLineWorthShowing', () => {
    /** One move is the recommendation printed a second time, on the next line. */
    it('says nothing for a line that is only the move above it', () => {
        expect(isBestLineWorthShowing(['b2e2'])).toBe(false);
        expect(isBestLineWorthShowing(undefined)).toBe(false);
        expect(isBestLineWorthShowing(['b2e2', 'h9g7'])).toBe(true);
    });
});
