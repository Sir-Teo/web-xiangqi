import { describe, expect, it } from 'vitest';
import {
    CAPTURE_FREE_DRAW_PLIES,
    CAPTURE_FREE_REPORT_PLIES,
    describeCaptureFree,
    formatCaptureFreeHeadline,
    formatCaptureFreeRule,
    readCaptureFreePlies,
} from './captureFreeRule';
import { START_FEN, boardToFen, parseFenBoard } from './xiangqi';

describe('readCaptureFreePlies', () => {
    it('reads the fifth field of a FEN the app writes', () => {
        const fen = boardToFen(parseFenBoard(START_FEN), 'w', 31, 44);
        expect(readCaptureFreePlies(fen)).toBe(44);
    });

    it('reads a start position as nothing taken yet', () => {
        expect(readCaptureFreePlies(`${START_FEN} w - - 0 1`)).toBe(0);
    });

    /** Storage readers here never throw on bad data; neither does this. */
    it('returns null rather than a number for anything that is not a count', () => {
        expect(readCaptureFreePlies(null)).toBeNull();
        expect(readCaptureFreePlies('')).toBeNull();
        expect(readCaptureFreePlies(START_FEN)).toBeNull();
        expect(readCaptureFreePlies(`${START_FEN} w - - x 1`)).toBeNull();
        expect(readCaptureFreePlies(`${START_FEN} w - - -4 1`)).toBeNull();
    });
});

describe('describeCaptureFree', () => {
    it('says nothing about an ordinary game', () => {
        expect(describeCaptureFree(0)).toBeNull();
        expect(describeCaptureFree(CAPTURE_FREE_REPORT_PLIES - 1)).toBeNull();
        expect(describeCaptureFree(null)).toBeNull();
        // `null` is not the only way to have no count. This is exported and
        // takes `number`, so NaN and Infinity reach it from anywhere that
        // arithmetic went wrong upstream, and both are larger-than or
        // unordered against the report threshold rather than smaller: the
        // `null` and `< threshold` tests above pass with the finite check
        // removed, and a NaN would go on to build a report of NaN moves.
        expect(describeCaptureFree(Number.NaN)).toBeNull();
        expect(describeCaptureFree(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('counts in full moves once it is worth saying', () => {
        const report = describeCaptureFree(CAPTURE_FREE_REPORT_PLIES);
        expect(report).toEqual({ plies: 60, moves: 30, movesLeft: 30, reached: false });
    });

    /** The engine's own limit: `rule60 >= 120` in position.cpp. */
    it('marks the point where the engine calls the game drawn', () => {
        expect(describeCaptureFree(CAPTURE_FREE_DRAW_PLIES - 1)?.reached).toBe(false);
        expect(describeCaptureFree(CAPTURE_FREE_DRAW_PLIES)?.reached).toBe(true);
        expect(describeCaptureFree(CAPTURE_FREE_DRAW_PLIES)?.movesLeft).toBe(0);
        // A position loaded past the limit is still past it, not negative.
        expect(describeCaptureFree(400)?.movesLeft).toBe(0);
    });

    it('rounds the moves left up, so the last one is not lost to the floor', () => {
        expect(describeCaptureFree(119)?.movesLeft).toBe(1);
        expect(describeCaptureFree(118)?.movesLeft).toBe(1);
        expect(describeCaptureFree(117)?.movesLeft).toBe(2);
    });
});

describe('what the notice reads', () => {
    it('names the count and what the engine will do with it', () => {
        const report = describeCaptureFree(90)!;
        expect(formatCaptureFreeHeadline(report)).toBe('45 counted moves without a capture');
        expect(formatCaptureFreeRule(report)).toContain('15 moves left');
        expect(formatCaptureFreeRule(report)).toContain('draw at 60 counted moves');
    });

    it('does not pluralise the last move', () => {
        expect(formatCaptureFreeRule(describeCaptureFree(119)!)).toContain('1 move left');
    });

    /**
     * The app never ends a game on a rule whose edition it cannot know, and
     * the wording has to keep saying so -- the same promise the repetition
     * notice makes.
     */
    it('reports the engine rather than adjudicating the game', () => {
        const rule = formatCaptureFreeRule(describeCaptureFree(CAPTURE_FREE_DRAW_PLIES)!);
        expect(rule).toContain('Play is not stopped');
        expect(rule).toContain('The engine can score a draw');
        expect(rule).toContain('mate and repetition rulings take precedence');
    });
});
