import { describe, expect, it } from 'vitest';
import {
    cloneBoardState,
    legalMovesFrom,
    otherSide,
    parseFenBoard,
    pieceSide,
    type BoardState,
    type Side,
} from './xiangqi';

/**
 * The move rules, counted against Pikafish's own count.
 *
 * `validatePieceMove` is this repo's second implementation of xiangqi: the
 * engine has one in C++ and the app has one in TypeScript, and everything the
 * app does on its own -- offering legal moves, deciding checkmate, refusing an
 * imported record -- rests on the app's. Nothing compared the two. The rules
 * that are easy to get subtly wrong are exactly the ones a spot-check misses:
 * the cannon needing precisely one screen to capture and none to move, the
 * horse's blocked leg, the elephant's blocked eye and its river, the general
 * and advisors held inside the palace, the soldier that may only turn sideways
 * after crossing, and the flying-general rule that makes a move illegal because
 * of two pieces that are nowhere near it.
 *
 * Perft is the standard way to settle it: count every legal sequence to a given
 * depth and compare totals. A disagreement anywhere -- one move offered too
 * many, one refused wrongly -- moves the count, and the count is one number.
 *
 * The reference numbers come from `go perft` on the shipped Pikafish, collected
 * one position per engine instance: asked of a single instance in sequence, the
 * engine ignores a `position` sent while it is still busy with the previous
 * perft, and every position quietly reports the first one's numbers. The start
 * position's 44 / 1920 / 79666 are also the published values for xiangqi, and
 * the mirrored start position with Black to move returning the same three is a
 * check on the collection method rather than on the rules.
 */

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';

function perft(state: BoardState, side: Side, depth: number): number {
    if (depth === 0) return 1;
    let total = 0;
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            const piece = state[rank][file];
            if (!piece || pieceSide(piece) !== side) continue;
            for (const target of legalMovesFrom(state, file, rank, side)) {
                const next = cloneBoardState(state);
                next[target.rank][target.file] = piece;
                next[rank][file] = '';
                total += depth === 1 ? 1 : perft(next, otherSide(side), depth - 1);
            }
        }
    }
    return total;
}

const CASES: { name: string; fen: string; side: Side; expected: [number, number, number] }[] = [
    {
        name: 'the starting position',
        fen: START,
        side: 'w',
        expected: [44, 1920, 79666],
    },
    {
        name: 'the mirrored start, Black to move',
        fen: START,
        side: 'b',
        expected: [44, 1920, 79666],
    },
    {
        name: 'after 1. C2=5 H8+7 2. H2+3 R9=8',
        // startpos moves h2e2 h9g7 b0c2 b9c7 -- derived by applying the moves
        // rather than written by hand, which is how the first attempt ended up
        // with a cannon still on h2 and an extra horse.
        fen: 'r1bakab1r/9/1cn3nc1/p1p1p1p1p/9/9/P1P1P1P1P/1CN1C4/9/R1BAKABNR',
        side: 'w',
        expected: [33, 1248, 42642],
    },
    {
        name: 'a middlegame with cannons and a blocked horse',
        fen: 'r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2P2P/1CN1B4/9/2BAKA1R1',
        side: 'w',
        expected: [6, 163, 5158],
    },
    {
        // Without this one the suite says nothing about the flying-general
        // rule: disabling that rule entirely left all five earlier positions
        // reporting identical counts, because none of them can expose the
        // generals within three plies. Here a single soldier stands between
        // them on the e-file, so every move that leaves the file is illegal
        // and only that rule says so.
        name: 'one piece between the generals on the e-file',
        fen: '4k4/9/9/9/4P4/9/9/9/9/4K4',
        side: 'w',
        expected: [4, 10, 51],
    },
    {
        // Cannons that can and cannot capture, on a file and on a rank: the
        // rule is exactly one screen to capture and none to move, which is the
        // piece most often implemented as though it moved like a chariot.
        name: 'cannons with and without a screen',
        fen: '3ak4/4a4/9/9/2C1c4/9/2P1p4/9/4A4/3AK4',
        side: 'w',
        expected: [10, 157, 2164],
    },
    {
        name: 'an endgame of generals, advisors and elephants',
        fen: '3ak4/4a4/9/9/9/9/9/4B4/4A4/3AK1B2',
        side: 'w',
        expected: [8, 31, 193],
    },
];

describe('the move rules, counted against the engine', () => {
    for (const testCase of CASES) {
        for (const depth of [1, 2, 3] as const) {
            it(`${testCase.name}: perft ${depth}`, () => {
                const board = parseFenBoard(testCase.fen);
                expect(perft(board, testCase.side, depth)).toBe(testCase.expected[depth - 1]);
            });
        }
    }
});
