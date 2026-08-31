import { describe, expect, it } from 'vitest';
import { parseBestMoveUci, parsePvUciMoves } from './useEngine';

/**
 * The two parsers that turn what the engine says into moves the app acts on.
 *
 * `boundedScore.test.ts` covers the other pure exports of `useEngine`; these
 * two had none, and they are the ones whose output a player can click. A
 * `bestmove` line becomes the move an AI opponent plays, and a `pv` line
 * becomes the continuation the board draws and offers to play through.
 *
 * Neither can be exercised by the browser suite in any pointed way: it runs
 * with no engine, so there is nothing emitting these lines.
 */

describe('reading a bestmove line', () => {
    it('takes the move', () => {
        expect(parseBestMoveUci('bestmove h2e2')).toBe('h2e2');
    });

    it('ignores the ponder move that usually follows it', () => {
        // `bestmove h2e2 ponder h9g7` is the ordinary shape. Taking the second
        // move would have the opponent play the reply it expected from you.
        expect(parseBestMoveUci('bestmove h2e2 ponder h9g7')).toBe('h2e2');
    });

    it('lowercases what it returns, because the rest of the app compares strings', () => {
        expect(parseBestMoveUci('bestmove H2E2')).toBe('h2e2');
    });

    it('returns nothing when the engine has no move to give', () => {
        // What a mated or stalemated position produces. An empty string is the
        // contract; a caller checking truthiness is what stops it being played.
        expect(parseBestMoveUci('bestmove (none)')).toBe('');
        expect(parseBestMoveUci('bestmove none')).toBe('');
        expect(parseBestMoveUci('bestmove 0000')).toBe('');
    });

    it('refuses a line that only mentions a move', () => {
        // `info` lines carry moves too, and reading one as a bestmove would
        // have the opponent move on an unfinished search.
        expect(parseBestMoveUci('info depth 8 pv h2e2 h9g7')).toBe('');
        expect(parseBestMoveUci('  bestmove h2e2  ')).toBe('h2e2');
    });

    it('refuses a line that merely contains the word bestmove', () => {
        // The anchor is the whole point, and the case above does not test it:
        // that line has no "bestmove" in it, so an unanchored pattern rejects
        // it too and the test passes either way. An engine's `info string` is
        // free-form and can say anything, including this.
        expect(parseBestMoveUci('info string bestmove h2e2 was refuted')).toBe('');
        expect(parseBestMoveUci('# bestmove h2e2')).toBe('');
    });

    it('refuses a coordinate that is not on this board', () => {
        // Files run a to i and ranks 0 to 9. `j` and two-digit ranks are not
        // xiangqi, and a chess engine's `e2e4`-shaped output is.
        expect(parseBestMoveUci('bestmove j2e2')).toBe('');
        expect(parseBestMoveUci('bestmove h2e10')).toBe('');
    });

    it('survives nothing at all', () => {
        expect(parseBestMoveUci('')).toBe('');
        expect(parseBestMoveUci(undefined as never)).toBe('');
    });
});

describe('reading a pv line', () => {
    it('takes the whole continuation', () => {
        expect(parsePvUciMoves('h2e2 h9g7 h0g2')).toEqual(['h2e2', 'h9g7', 'h0g2']);
    });

    it('stops at the first thing that is not a move', () => {
        // A pv is the tail of an info line, and anything after it that is not a
        // move means the pv has ended. Skipping past it instead would splice
        // two unrelated halves into one continuation.
        expect(parsePvUciMoves('h2e2 h9g7 string h0g2')).toEqual(['h2e2', 'h9g7']);
    });

    it('lowercases every move, not only the first', () => {
        expect(parsePvUciMoves('H2E2 h9G7')).toEqual(['h2e2', 'h9g7']);
    });

    it('is unbothered by the spacing an engine actually uses', () => {
        expect(parsePvUciMoves('  h2e2\th9g7  ')).toEqual(['h2e2', 'h9g7']);
    });

    it('returns nothing for a pv that holds no moves', () => {
        expect(parsePvUciMoves('')).toEqual([]);
        expect(parsePvUciMoves('   ')).toEqual([]);
        expect(parsePvUciMoves('(none)')).toEqual([]);
    });
});
