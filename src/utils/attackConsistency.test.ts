import { describe, expect, it } from 'vitest';
import {
    attacksSquare,
    cloneBoardState,
    legalMovesFrom,
    otherSide,
    parseFenBoard,
    pieceSide,
    validatePieceMove,
    type BoardState,
    type Side,
} from './xiangqi';

/**
 * The rules are written out twice in this file, and both have to say the same
 * thing.
 *
 * `validatePieceMove` decides whether a move may be played. `attacksSquare` is
 * a separate implementation of the same geometry, used by `isInCheck` and
 * through it by checkmate, stalemate and every game result the app reports.
 * They share `countBetweenOrthogonal` and little else: the horse's leg, the
 * elephant's eye, the cannon's screen and the soldier's river are each coded
 * twice.
 *
 * That split is invisible to a perft, which only walks the mover. Breaking the
 * horse-leg test inside `attacksSquare` leaves every perft count untouched --
 * confirmed -- while quietly making the app see checks that are not there and
 * miss ones that are. The consequence is not a wrong move; it is a wrong
 * *result*, announced to both players.
 *
 * So: for every piece and every enemy piece on the board, the two must agree on
 * whether a capture is geometrically possible. King safety is deliberately not
 * part of the comparison -- a move can be geometrically fine and still illegal
 * because it exposes the general, and `attacksSquare` neither knows nor should
 * know about that.
 */

const KING_SAFETY_REASONS = new Set([
    'generals cannot face each other',
    'move leaves general in check',
]);

const POSITIONS = [
    ['the starting position', 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR'],
    ['a middlegame', 'r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2P2P/1CN1B4/9/2BAKA1R1'],
    ['cannons with and without a screen', '3ak4/4a4/9/9/2C1c4/9/2P1p4/9/4A4/3AK4'],
    ['one piece between the generals', '4k4/9/9/9/4P4/9/9/9/9/4K4'],
    ['an endgame', '3ak4/4a4/9/9/9/9/9/4B4/4A4/3AK1B2'],
    // A blocked elephant eye pointed straight at an enemy piece: the red
    // elephant on c0 is two diagonals from the black cannon on e2, and its own
    // advisor sits on d1 in between. Without this, breaking the eye test inside
    // `attacksSquare` passed every check here as well as every perft.
    ['a blocked elephant eye facing an enemy piece', '4k4/9/9/9/9/9/9/4c4/3A5/2B1K4'],
    // Crossed soldiers with an enemy piece on each of the squares they can
    // turn onto. This comparison only looks at squares that *hold* an enemy
    // piece, and no position above put anything beside a soldier past the
    // river -- so the sideways rule inside `attacksSquare` was never compared
    // with the one inside `validatePieceMove`. Breaking it made the app blind
    // to a check delivered sideways by a soldier, and every test here and
    // every perft count passed. Both colours, since the two are coded
    // separately a few lines apart.
    ['crossed soldiers beside what they can take', '3k5/9/2pPp4/9/9/9/9/2Pp4p/9/3K5'],
] as const;

/** Every position reachable within `depth` plies, so the comparison is not
 *  limited to positions someone thought to write down. */
function walk(state: BoardState, side: Side, depth: number, out: { state: BoardState; side: Side }[]) {
    out.push({ state, side });
    if (depth === 0) return;
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            const piece = state[rank][file];
            if (!piece || pieceSide(piece) !== side) continue;
            for (const target of legalMovesFrom(state, file, rank, side)) {
                const next = cloneBoardState(state);
                next[target.rank][target.file] = piece;
                next[rank][file] = '';
                walk(next, otherSide(side), depth - 1, out);
            }
        }
    }
}

function disagreements(state: BoardState, side: Side): string[] {
    const found: string[] = [];
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            const piece = state[rank][file];
            if (!piece || pieceSide(piece) !== side) continue;
            // The general is left out on purpose: `attacksSquare` gives it the
            // flying-general attack down an open file, which is a rule about
            // check and never a move it may play.
            if (piece.toUpperCase() === 'K') continue;

            for (let toRank = 0; toRank < 10; toRank += 1) {
                for (let toFile = 0; toFile < 9; toFile += 1) {
                    const target = state[toRank][toFile];
                    if (!target || pieceSide(target) === side) continue;

                    const attacks = attacksSquare(state, file, rank, piece, toFile, toRank);
                    const result = validatePieceMove(
                        state,
                        { fromFile: file, fromRank: rank, toFile, toRank, raw: '' },
                        side
                    );
                    const geometricallyLegal = result.ok || KING_SAFETY_REASONS.has(result.reason ?? '');
                    if (attacks !== geometricallyLegal) {
                        found.push(
                            `${piece} ${String.fromCharCode(97 + file)}${rank} -> ` +
                            `${String.fromCharCode(97 + toFile)}${toRank}: attacksSquare=${attacks}, ` +
                            `validatePieceMove=${result.ok ? 'ok' : result.reason}`
                        );
                    }
                }
            }
        }
    }
    return found;
}

describe('check detection and move legality describe the same rules', () => {
    for (const [name, fen] of POSITIONS) {
        it(`agree everywhere within two plies of ${name}`, () => {
            const reached: { state: BoardState; side: Side }[] = [];
            walk(parseFenBoard(fen), 'w', 2, reached);
            expect(reached.length).toBeGreaterThan(1);

            const problems: string[] = [];
            for (const { state, side } of reached) {
                problems.push(...disagreements(state, side));
                problems.push(...disagreements(state, otherSide(side)));
            }
            expect([...new Set(problems)].slice(0, 8)).toEqual([]);
        });
    }
});
