import { describe, expect, it } from 'vitest';
import { BOUNDED_SCORE_PATTERN, isBoundedScoreLine, shouldReplacePvLine, type PvLine } from './useEngine';

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

describe('holding a PV line against a later bound', () => {
    const line = (depth: number, score: number, bounded?: boolean): PvLine =>
        ({ depth: String(depth), score, scoreStr: String(score), moves: ['h2e2'], multipv: 0, searchTag: 's1', bounded });

    it('takes any line when the slot is empty', () => {
        expect(shouldReplacePvLine(undefined, line(20, 30))).toBe(true);
    });

    it('takes an exact line over anything held', () => {
        expect(shouldReplacePvLine(line(22, 30), line(22, 45))).toBe(true);
        expect(shouldReplacePvLine(line(22, 30, true), line(22, 45))).toBe(true);
    });

    it('refuses a bound that would displace an exact score at the same depth', () => {
        expect(shouldReplacePvLine(line(22, 300), line(22, 900, true))).toBe(false);
        expect(shouldReplacePvLine(line(22, 300), line(18, 900, true))).toBe(false);
    });

    it('still takes a deeper bound, which is the most the engine has said', () => {
        expect(shouldReplacePvLine(line(22, 300), line(24, 900, true))).toBe(true);
    });

    it('compares depth as a number, not as the string it arrives as', () => {
        // depth comes off the wire as text; "9" must not beat "22".
        expect(shouldReplacePvLine(line(22, 300), line(9, 900, true))).toBe(false);
    });
});
