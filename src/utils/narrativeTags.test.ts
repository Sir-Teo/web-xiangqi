import { describe, expect, it } from 'vitest';
import { narrativeTagToneClass, narrativeTags } from './narrativeTags';

const ids = (tags: { id: string }[]) => tags.map(tag => tag.id);

describe('describing the arc of a game', () => {
    it('says nothing about a game too short to have one', () => {
        expect(narrativeTags([0, 50, 100], 'red-wins')).toEqual([]);
        expect(narrativeTags([], 'red-wins')).toEqual([]);
    });

    it('labels a quiet draw and stops there', () => {
        expect(ids(narrativeTags([0, 10, -10, 5, 0, 0], 'draw'))).toEqual(['draw']);
    });

    it('says when a draw was a win someone let go', () => {
        // Red reaches a decisive advantage and the game still ends level.
        expect(ids(narrativeTags([0, 200, 500, 800, 300, 0], 'draw'))).toEqual(['draw', 'missedWin']);
        expect(ids(narrativeTags([0, -200, -500, -800, -300, 0], 'draw'))).toEqual(['draw', 'missedWin']);
    });

    it('calls a recovery from a lost position a comeback', () => {
        const tags = narrativeTags([0, -100, -400, -700, -300, 200, 800], 'red-wins');
        expect(ids(tags)).toContain('comeback');
        expect(ids(tags)).not.toContain('wire');
    });

    it('calls an unbroken lead wire-to-wire', () => {
        expect(ids(narrativeTags([50, 100, 200, 300, 400, 600], 'red-wins'))).toContain('wire');
    });

    it('flags a winning position that was let slip', () => {
        expect(ids(narrativeTags([0, 200, 600, 900, 200, -400, -800], 'black-wins'))).toContain('missedWin');
    });

    it('calls a decisive game that never opened up a nail-biter', () => {
        expect(ids(narrativeTags([0, 20, -20, 30, -30, 10, -40], 'black-wins'))).toEqual(['tight']);
    });

    it('trusts the recorded result over the final evaluation', () => {
        // The series ends favouring Red, but Black is recorded as the winner.
        expect(ids(narrativeTags([0, 100, 300, 500, 700, 900], 'black-wins'))).toContain('missedWin');
    });

    it('falls back to the final evaluation for an unfinished game', () => {
        expect(ids(narrativeTags([50, 100, 200, 300, 500, 700], null))).toContain('wire');
        expect(ids(narrativeTags([0, 0, 0, 0, 0, 0], null))).toEqual(['draw']);
    });

    it('carries the last evaluation forward through unevaluated moves', () => {
        // The gaps must not read as a swing back to even.
        const withGaps = narrativeTags([0, 400, undefined, undefined, 700, 900], 'red-wins');
        const filled = narrativeTags([0, 400, 400, 400, 700, 900], 'red-wins');
        expect(ids(withGaps)).toEqual(ids(filled));
    });

    it('reads Red-positive evaluations the right way round', () => {
        // The same shape, mirrored, must name the other side.
        const red = narrativeTags([0, -700, -400, 200, 600, 900], 'red-wins');
        const black = narrativeTags([0, 700, 400, -200, -600, -900], 'black-wins');
        expect(ids(red)).toEqual(ids(black));
        expect(red.find(t => t.id === 'comeback')?.title).toContain('Red');
        expect(black.find(t => t.id === 'comeback')?.title).toContain('Black');
    });

    it('never repeats a tag', () => {
        const tags = narrativeTags([0, 200, 600, 900, 200, -400, -800], 'black-wins');
        expect(new Set(ids(tags)).size).toBe(tags.length);
    });
});

describe('tone classes', () => {
    it('gives each tone a distinct class', () => {
        const classes = (['good', 'bad', 'neutral'] as const).map(narrativeTagToneClass);
        expect(new Set(classes).size).toBe(3);
        for (const value of classes) expect(value).toContain('review-narrative');
    });
});

/**
 * The three boundaries here that a test can actually stand on.
 *
 * A mutation sweep flagged all nine thresholds in this file. Six of them are
 * unreachable by construction: the values compared are `getWinningChancePercent`
 * outputs, and no integer centipawn score maps to exactly 85, 30, 15 or 52, so
 * `>= MISSED_WIN_HIGH` and `> MISSED_WIN_HIGH` cannot be told apart by any
 * input the engine produces. These three can be stood on, so they are.
 */
describe('the edges of the arc thresholds', () => {
    it('counts a lead that only ever touched even as wire-to-wire', () => {
        // An evaluation of exactly 0 is exactly 50%, which is the one place
        // WIRE_LEVEL can be met rather than passed -- and 0 is the commonest
        // evaluation there is, being the value carried forward before the
        // engine has said anything.
        const tags = narrativeTags([0, 0, 0, 0, 0, 0, 0, 600], 'red-wins');
        expect(tags.map((tag) => tag.id)).toEqual(['wire']);
    });

    it('names the side that was winning when both sides peaked equally', () => {
        // The tie-break in the title reads `maxRed >= 100 - minRed`, so it is
        // only live where those are exactly equal. +/-500 is not such a pair:
        // the two percentages sum to exactly 100 yet `hi === 100 - lo` is
        // false by 1.4e-14, because the sum and the subtraction round
        // differently. +/-474 does satisfy it, and clears 85 so the tag is
        // reached at all.
        const tags = narrativeTags([474, -474, 474, -474, 474, -474, 0, 0], 'draw');
        expect(tags.map((tag) => tag.id)).toEqual(['draw', 'missedWin']);
        expect(tags[1].title).toBe('Red reached a winning position and drew.');
    });

    it('carries the last real evaluation past one that is not a number', () => {
        // NaN is a number by `typeof`, so only the `Number.isFinite` half of
        // the guard rejects it. Without that half NaN poisons the whole series
        // and every comparison below goes false, leaving the game with no arc
        // at all.
        const tags = narrativeTags([600, 600, 600, Number.NaN, 600, 600, 600, 600], 'red-wins');
        expect(tags.map((tag) => tag.id)).toEqual(['wire']);
    });
});
