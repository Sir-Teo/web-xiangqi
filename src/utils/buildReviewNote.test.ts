import { describe, expect, it } from 'vitest';
import { MAX_REPORTED_CENTIPAWN_LOSS, buildReviewNote } from './review';

const note = (over: Partial<Parameters<typeof buildReviewNote>[0]> = {}) =>
    buildReviewNote({ quality: 'good', playedMove: 'h2e2', swing: 40, ...over });

/**
 * The sentence under every reviewed move. It is a priority chain, and the order
 * is the behaviour: whether a move was best, whether there is a better move to
 * name, and whether the player is still winning all change what is said before
 * the number does. None of it was tested; the layout suite asserted one branch
 * in passing.
 */
describe('the note under a reviewed move', () => {
    it('says nothing about a number when the move was best', () => {
        expect(note({ quality: 'best' })).toBe('Engine-approved move.');
    });

    it('quantifies a good move without naming an alternative', () => {
        expect(note({ quality: 'good', swing: 25 })).toBe('Solid choice. Only 25cp off the best line.');
    });

    it('names the stronger move when there is one', () => {
        const text = note({ quality: 'mistake', swing: 240, bestMove: 'b0c2' });
        expect(text).toMatch(/^Missed a stronger continuation\./);
        expect(text).toMatch(/240cp/);
        expect(text).toMatch(/B0|b0/);
    });

    it('scales its language with the severity', () => {
        expect(note({ quality: 'blunder', swing: 600, bestMove: 'b0c2' })).toMatch(/^Big miss\./);
        expect(note({ quality: 'mistake', swing: 240, bestMove: 'b0c2' })).toMatch(/^Missed a stronger/);
        expect(note({ quality: 'inaccuracy', swing: 90, bestMove: 'b0c2' })).toMatch(/^Small slip\./);
    });

    it('does not name a move that is the one just played', () => {
        const text = note({ quality: 'mistake', swing: 240, bestMove: 'h2e2', playedMove: 'h2e2' });
        expect(text).toBe('Noticeable drop of 240cp.');
    });

    /**
     * Being still winning changes the message, not just the number: a player
     * who threw away half a winning position has not lost, and the note should
     * not read like they had.
     */
    it('says so when the position is still won', () => {
        const named = note({
            quality: 'blunder', swing: 500, bestMove: 'b0c2', retainedDecisiveAdvantage: true,
        });
        expect(named).toMatch(/^Still winning, but/);

        const unnamed = note({ quality: 'mistake', swing: 300, retainedDecisiveAdvantage: true });
        expect(unnamed).toBe('Still winning, but evaluation dropped by 300cp.');
    });

    it('ignores that softening for a move that was not critical', () => {
        // "good" is not a critical quality, so it takes the good-move branch.
        expect(note({ quality: 'good', swing: 30, retainedDecisiveAdvantage: true }))
            .toMatch(/^Solid choice\./);
    });

    it('falls through to a plain reading when nothing else applies', () => {
        expect(note({ quality: 'inaccuracy', swing: 90 })).toBe('Evaluation slipped by 90cp.');
        expect(note({ quality: 'blunder', swing: 900 })).toBe('Major evaluation swing: 900cp.');
    });

    /**
     * A forced mate is off this scale rather than a large number on it. The
     * swing is bounded like the averages are, and the "+" is what says the
     * reported figure is a bound and not a measurement.
     */
    it('marks a bounded swing as a bound, not as a measurement', () => {
        const mate = note({ quality: 'blunder', swing: 30_000, bestMove: 'b0c2' });
        expect(mate).toMatch(new RegExp(`${MAX_REPORTED_CENTIPAWN_LOSS}\\+cp`));
        expect(mate).not.toMatch(/30000/);
    });

    it('leaves an unbounded swing unmarked', () => {
        expect(note({ quality: 'mistake', swing: 240, bestMove: 'b0c2' })).not.toMatch(/\+cp/);
    });

    it('never puts a non-number in front of the reader', () => {
        // `reportedCentipawnLoss` guards this, and web-chess's copy guards it
        // too -- checked, because a NaN reaching this string would be read as
        // "NaNcp" by every user of the review panel.
        expect(note({ quality: 'mistake', swing: Number.NaN })).toBe('Noticeable drop of 0cp.');
        expect(note({ quality: 'good', swing: Number.POSITIVE_INFINITY }))
            .toBe('Solid choice. Only 0cp off the best line.');
    });

    it('rounds rather than printing a fraction at the reader', () => {
        expect(note({ quality: 'good', swing: 24.6 })).toBe('Solid choice. Only 25cp off the best line.');
    });
});
