import { describe, expect, it } from 'vitest';
import { formatMoveInStyle, parseMoveInNotation } from './xiangqiNotation';
import {
    START_FEN,
    cloneBoardState,
    legalMovesFrom,
    otherSide,
    parseFenBoard,
    pieceSide,
    squareToUci,
    validateMoveStr,
    type BoardState,
    type Side,
} from './xiangqi';

/**
 * The two notation guarantees, over positions reached by playing rather than
 * by being written down.
 *
 * `xiangqiNotation.test.ts` holds both properties already, over five positions
 * chosen for the shapes that collide -- stacked chariots, stacked cannons,
 * soldiers three and four deep. That corpus is good and it is also
 * hand-written, which is the failure mode this project has hit twice: an
 * earlier sweep found `attacksSquare` blind to a sideways soldier check
 * because every position in its differential had been written from the opening
 * rather than from the rules, and this session found the file-number rule
 * wrong beside a lone soldier for the same reason.
 *
 * Random legal play reaches middlegames and endgames nobody would think to
 * type: pieces doubled by accident, a file emptied, a chariot behind a cannon.
 *
 * ## What these two properties cannot see
 *
 * They are a complement to the hand-written corpus, not a replacement, and the
 * boundary is worth stating because it is not obvious.
 *
 * - **The round trip cannot fail on its own.** `parseMoveInNotation` works by
 *   formatting every legal move and comparing, so it agrees with the formatter
 *   by construction. Any formatter change that stays injective round-trips.
 * - **Distinctness only catches collisions**, which means it only catches
 *   *under*-disambiguation. Measured against six deliberate defects: dropping
 *   the stack marker, writing a destination file where a distance belongs and
 *   shifting the Chinese stack label are all caught, and so is dropping the
 *   file number beside a marker -- each makes two moves share a string. But
 *   **swapping front for rear** and **adding a file number that is not needed**
 *   are injective and wrong, and neither property can see them. Only an
 *   expected-string assertion catches those, which is what
 *   `xiangqiNotation.test.ts` is for.
 */
function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function everyLegalMove(board: BoardState, side: Side): string[] {
    const moves: string[] = [];
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            if (pieceSide(board[rank][file]) !== side) continue;
            for (const target of legalMovesFrom(board, file, rank, side)) {
                moves.push(squareToUci(file, rank) + squareToUci(target.file, target.rank));
            }
        }
    }
    return moves;
}

/**
 * Where a walk starts.
 *
 * The opening is not enough on its own, and measuring says so: mutating the
 * file-number rule that only bites when **two files each hold a stack** is
 * caught by the hand-written corpus and missed by 21 walks from the start
 * position, because random play does not reach that shape in 140 plies. So
 * some walks begin at the rare shapes instead and explore around them --
 * which is what a hand-written fixture cannot do.
 */
const STARTS: Array<[string, string]> = [
    ['the opening', START_FEN],
    ['stacked chariots and cannons', '3ak4/4a4/9/9/9/9/R3C4/R3C4/9/3AKA3'],
    ['soldiers three deep on two files', '3ak4/4a4/9/P3P4/P3P4/P3P4/9/9/9/3AKA3'],
    // Two files, the same piece, exactly two deep. This is the only shape that
    // exercises the file-number-beside-a-marker rule: at three deep the WXF
    // form counts from the front and carries the file anyway, and two stacks
    // of *different* pieces do not count as two stacks of either.
    ['soldiers two deep on two files', '4k4/9/9/9/9/9/P3P4/9/9/P3P3K'],
    // One stack and one loner: the shape that decides whether a *second stack*
    // or merely a second piece is what forces the file number.
    ['a stack beside a lone soldier', '4k4/9/9/9/9/4P2P1/4P4/9/9/4K4'],
];

/** Play `plies` random legal moves, or stop early if a side is mated. */
function playOut(seed: number, plies: number, fen = START_FEN): { board: BoardState; side: Side } {
    const random = mulberry32(seed);
    let board = parseFenBoard(fen);
    let side: Side = 'w';
    for (let ply = 0; ply < plies; ply += 1) {
        const legal = everyLegalMove(board, side);
        if (!legal.length) break;
        const uci = legal[Math.floor(random() * legal.length)];
        const checked = validateMoveStr(uci, board, side);
        if (!checked.ok || !checked.mv) break;
        const next = cloneBoardState(board);
        const { fromFile, fromRank, toFile, toRank } = checked.mv;
        next[toRank][toFile] = next[fromRank][fromFile];
        next[fromRank][fromFile] = '';
        board = next;
        side = otherSide(side);
    }
    return { board, side };
}

const POSITIONS = STARTS.flatMap(([from, fen]) =>
    (fen === START_FEN ? [4, 11, 25, 40, 60, 90, 140] : [0, 2, 5, 9, 14]).flatMap(
        (plies) => [1, 2, 3].map((seed) => ({ from, fen, plies, seed })),
    ),
);

describe('notation over positions reached by playing', () => {
    it.each(POSITIONS)('names every legal move exactly once: $from, $plies plies, seed $seed', ({ fen, plies, seed }) => {
        const { board, side } = playOut(seed, plies, fen);
        const moves = everyLegalMove(board, side);
        expect(moves.length).toBeGreaterThan(0);

        for (const style of ['wxf', 'chinese'] as const) {
            const seen = new Map<string, string>();
            for (const uci of moves) {
                const text = formatMoveInStyle(board, uci, style);
                expect(text, `${style} produced nothing for ${uci}`).toBeTruthy();
                const clash = seen.get(text);
                expect(clash, `${style}: ${clash} and ${uci} both write ${text}`).toBeUndefined();
                seen.set(text, uci);
            }
        }
    });

    it.each(POSITIONS)('reads back everything it writes: $from, $plies plies, seed $seed', ({ fen, plies, seed }) => {
        const { board, side } = playOut(seed, plies, fen);
        for (const uci of everyLegalMove(board, side)) {
            for (const style of ['wxf', 'chinese'] as const) {
                const text = formatMoveInStyle(board, uci, style);
                expect(parseMoveInNotation(board, side, text), `${style} ${text}`).toBe(uci);
            }
        }
    });
});
