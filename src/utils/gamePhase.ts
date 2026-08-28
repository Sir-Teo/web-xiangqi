/**
 * Which phase of the game a move belongs to.
 *
 * web-katrain splits phases by move number, with a table per board size. That
 * suits Go, where the board fills at a predictable rate. Xiangqi is like chess
 * in this respect: an early double-rook trade and a 90-move cannon ending are
 * both "the middle" by move count, so the split is made on material instead,
 * with a move-number cap so a quiet symmetrical opening is not called an
 * opening forever.
 *
 * Only the attacking pieces are counted. Advisors and elephants never leave
 * their own half and pawns are worth little until they cross the river, so
 * neither tracks the shape of the game the way the chariots, horses and
 * cannons do.
 *
 * The phase names match web-katrain's and web-chess's so all three reports
 * read the same way.
 */

import type { BoardState } from './xiangqi';

/** Conventional xiangqi strength: chariot 9, cannon 5, horse 4. */
const PIECE_VALUES: Record<string, number> = { r: 9, c: 5, n: 4 };

/** Both sides, every attacking piece: 2 x (2x9 + 2x5 + 2x4). */
export const FULL_ATTACKING_MATERIAL = 72;

/**
 * Both sides together. A chariot and cannon each (28) is an endgame; two
 * chariots each (36) is not.
 */
const ENDGAME_MATERIAL = 28;

/** Through move 12, the conventional span of an opening. */
const OPENING_MAX_PLY = 24;

/**
 * At most one pair of cannons or horses exchanged. A chariot trade takes
 * material below this, which ends the opening — as it should.
 */
const OPENING_MIN_MATERIAL = 62;

export type GamePhase = 'opening' | 'middleGame' | 'endgame';

export const GAME_PHASES: Array<{ key: GamePhase; label: string }> = [
    { key: 'opening', label: 'Opening' },
    { key: 'middleGame', label: 'Middlegame' },
    { key: 'endgame', label: 'Endgame' },
];

export function getPhaseLabel(phase: GamePhase): string {
    return GAME_PHASES.find(entry => entry.key === phase)?.label ?? 'Opening';
}

/** What one piece is worth for phase purposes. Anything else is worth nothing. */
export function attackingPieceValue(piece: string | null | undefined): number {
    if (!piece) return 0;
    return PIECE_VALUES[piece.toLowerCase()] ?? 0;
}

/** Chariots, cannons and horses left on the board, both sides. */
export function attackingMaterial(board: BoardState): number {
    let total = 0;
    for (const rank of board ?? []) {
        for (const piece of rank ?? []) {
            total += attackingPieceValue(piece);
        }
    }
    return total;
}

/**
 * The phase a move belongs to, read from the position it was played in.
 *
 * Records store the board *after* the move along with whatever it captured, so
 * the position before it is the two added back together — no replay needed.
 */
export function getMovePhaseForRecord(
    record: { board: BoardState; captured?: string },
    ply: number,
): GamePhase {
    const material = attackingMaterial(record.board) + attackingPieceValue(record.captured);
    if (material <= ENDGAME_MATERIAL) return 'endgame';
    if (ply <= OPENING_MAX_PLY && material >= OPENING_MIN_MATERIAL) return 'opening';
    return 'middleGame';
}
