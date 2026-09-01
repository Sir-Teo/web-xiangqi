import { describe, expect, it } from 'vitest';
import {
    START_FEN,
    boardToFen,
    cloneBoardState,
    legalMovesFrom,
    otherSide,
    parseFenBoard,
    pieceSide,
    type BoardState,
    type Side,
} from './xiangqi';

/**
 * The string the engine is actually asked about.
 *
 * For anything but the default start, `App.tsx` sends
 * `position fen ${boardToFen(...)}`. So on a custom position, a loaded study or
 * an imported record with a `[FEN]` tag, every evaluation the player reads is
 * of whatever this serializer produced. A board it writes wrongly is not a
 * visible bug: the engine answers confidently about a position that is not the
 * one on screen.
 *
 * Two things are checked. That the serializer is faithful -- write a board, read
 * it back, get the same board -- over every position within three plies of the
 * opening, which is 1,965 boards of varying shapes rather than a handful
 * someone chose. And that the exact strings it produces for the positions in
 * `perft.test.ts` are the ones Pikafish was measured against there, so the
 * agreement recorded in that file is agreement about the app's own output and
 * not about a FEN written by hand alongside it.
 */

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';

function boardsWithin(state: BoardState, side: Side, depth: number): { state: BoardState; side: Side }[] {
    const out: { state: BoardState; side: Side }[] = [{ state, side }];
    if (depth === 0) return out;
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            const piece = state[rank][file];
            if (!piece || pieceSide(piece) !== side) continue;
            for (const target of legalMovesFrom(state, file, rank, side)) {
                const next = cloneBoardState(state);
                next[target.rank][target.file] = piece;
                next[rank][file] = '';
                out.push(...boardsWithin(next, otherSide(side), depth - 1));
            }
        }
    }
    return out;
}

describe('the FEN the engine is given', () => {
    it('round-trips every board within three plies of the opening', () => {
        const reached = boardsWithin(parseFenBoard(START), 'w', 2);
        expect(reached.length).toBeGreaterThan(1900);

        const broken: string[] = [];
        for (const { state, side } of reached) {
            const fen = boardToFen(state, side, 1);
            const reparsed = parseFenBoard(fen.split(' ')[0]);
            if (JSON.stringify(reparsed) !== JSON.stringify(state)) broken.push(fen);
            // And writing the re-read board again must give the same string.
            if (boardToFen(reparsed, side, 1) !== fen) broken.push(`unstable: ${fen}`);
        }
        expect(broken.slice(0, 5)).toEqual([]);
    });

    it('records the side to move, which decides whose evaluation it is', () => {
        const board = parseFenBoard(START);
        expect(boardToFen(board, 'w', 1)).toContain(' w ');
        expect(boardToFen(board, 'b', 1)).toContain(' b ');
    });

    // Byte-for-byte the strings `go perft` was run against in perft.test.ts.
    const MEASURED: [string, Side, string][] = [
        [START, 'w', 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'],
        [START, 'b', 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1'],
        ['r1bakab1r/9/1cn3nc1/p1p1p1p1p/9/9/P1P1P1P1P/1CN1C4/9/R1BAKABNR', 'w',
         'r1bakab1r/9/1cn3nc1/p1p1p1p1p/9/9/P1P1P1P1P/1CN1C4/9/R1BAKABNR w - - 0 1'],
        ['4k4/9/9/9/4P4/9/9/9/9/4K4', 'w', '4k4/9/9/9/4P4/9/9/9/9/4K4 w - - 0 1'],
        ['3ak4/4a4/9/9/2C1c4/9/2P1p4/9/4A4/3AK4', 'w', '3ak4/4a4/9/9/2C1c4/9/2P1p4/9/4A4/3AK4 w - - 0 1'],
        ['r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2P2P/1CN1B4/9/2BAKA1R1', 'w',
         'r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2P2P/1CN1B4/9/2BAKA1R1 w - - 0 1'],
        ['3ak4/4a4/9/9/9/9/9/4B4/4A4/3AK1B2', 'w', '3ak4/4a4/9/9/9/9/9/4B4/4A4/3AK1B2 w - - 0 1'],
    ];

    it('writes the perft positions exactly as the engine was asked about them', () => {
        for (const [fen, side, expected] of MEASURED) {
            expect(boardToFen(parseFenBoard(fen), side, 1), fen).toBe(expected);
        }
    });
});

describe('the halfmove clock in that FEN', () => {
    /**
     * Not a decoration, and the engine settles the argument. The same endgame
     * searched at depth 14 reports mate in 3 when this field says 0 or 45, and
     * 0.00 when it says 119 -- Pikafish adjudicates the natural limit from it.
     * `boardToFen` wrote a flat 0 into every FEN the app produced, which tells
     * the engine no progress-free moves have happened and can turn a drawn
     * endgame into a claimed win.
     */
    const board = parseFenBoard(START_FEN);

    it('writes the clock it is given', () => {
        expect(boardToFen(board, 'w', 30, 45)).toContain(' w - - 45 30');
    });

    it('still writes a zero when nobody supplies one', () => {
        // Every existing caller, and the opening position, where it is true.
        expect(boardToFen(board, 'w', 1)).toContain(' w - - 0 1');
    });

    it('refuses a clock that is not a count', () => {
        for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(boardToFen(board, 'w', 1, bad as number), String(bad)).toContain(' w - - 0 1');
        }
    });

    it('truncates a fractional clock rather than writing a decimal point into a FEN', () => {
        expect(boardToFen(board, 'w', 1, 12.7)).toContain(' w - - 12 1');
    });
});
