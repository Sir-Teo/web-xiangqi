import { describe, expect, it } from 'vitest';
import { BOUNDED_SCORE_PATTERN, isBoundedScoreLine } from './useEngine';

/**
 * `score cp 150 lowerbound` means "at least 150", not "150". Both flags come
 * out of aspiration-window re-searches, and the exact line normally follows a
 * moment later -- but a search stopped in between leaves the bound as the last
 * thing the app saw. This repo did not parse the flags at all, so a bound
 * became an evaluation, and in a review an evaluation that is really an
 * inequality becomes a swing the player never caused.
 *
 * web-chess parsed them and dropped them before they reached a snapshot, which
 * came to the same thing; it now prefers an exact score at the same depth.
 */
describe('bounded engine scores', () => {
    it('recognises both flags', () => {
        expect(isBoundedScoreLine('info depth 20 score cp 150 lowerbound pv h2e2')).toBe(true);
        expect(isBoundedScoreLine('info depth 20 score cp 150 upperbound pv h2e2')).toBe(true);
    });

    it('leaves an exact line alone', () => {
        expect(isBoundedScoreLine('info depth 20 score cp 150 nodes 5000 pv h2e2')).toBe(false);
        expect(isBoundedScoreLine('info depth 20 score mate 3 pv h2e2')).toBe(false);
    });

    it('does not match a move or a field that merely contains the word', () => {
        // The pattern is used against whole info lines; a PV move or an option
        // name must not be mistaken for a bound.
        expect(isBoundedScoreLine('info depth 12 pv boundedmove upperboundish')).toBe(false);
        expect(isBoundedScoreLine('option name UpperboundHack type check')).toBe(false);
    });

    it('is not sticky across calls', () => {
        // A global regex would carry lastIndex between tests and start
        // returning false for lines it had already matched.
        const line = 'info depth 8 score cp 20 lowerbound pv h2e2';
        expect(BOUNDED_SCORE_PATTERN.test(line)).toBe(true);
        expect(BOUNDED_SCORE_PATTERN.test(line)).toBe(true);
        expect(BOUNDED_SCORE_PATTERN.test(line)).toBe(true);
    });
});
