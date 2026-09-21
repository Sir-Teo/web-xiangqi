import type { BoardState } from './xiangqi';

export type PieceCode = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P' | 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p';

/**
 * What each side has taken, and who is ahead.
 *
 * Two questions that look like one and are not, which is how they came to be
 * answered by the same subtraction and both be wrong on a position that was set
 * up rather than played to.
 *
 * The captured trays were `standard opening set − what is on the board`, with
 * "standard opening set" a constant. Load an endgame FEN -- two generals, some
 * advisors, one chariot -- and the board reported "captured by Red: 2 black
 * chariots, 2 horses, 2 cannons, 2 elephants, 5 soldiers". None of it happened.
 * Nothing had been captured; the position simply started that way, and FEN
 * setup is how anyone studies an endgame.
 *
 * The *balance* survived that only by algebra. Both sides being subtracted from
 * the same set means the difference of their losses equals the difference of
 * what they still hold -- so it was right for a standard start and for a
 * custom one, and would have gone wrong the moment the captures were fixed
 * without it. It is now read straight off the board, where it cannot depend on
 * where the game began.
 */

const PIECE_VALUES_TENTHS: Record<PieceCode, number> = {
    K: 0, A: 20, B: 20, N: 40, R: 90, C: 45, P: 10,
    k: 0, a: 20, b: 20, n: 40, r: 90, c: 45, p: 10,
};

/**
 * The piece types that can be taken, in the order a captured tray shows them.
 * The general is not among them: the game ends before it comes off.
 *
 * One list, mirrored, rather than two written out. They were two, and the two
 * could disagree: dropping the soldier from Red's list -- so captured soldiers
 * stop counting towards the material readout -- passed the whole suite, while
 * the same omission on Black's list was caught. Nothing about the rules is
 * asymmetric, so neither should this be.
 *
 * `satisfies` keeps every entry a real lowercase, non-general code; the count
 * is checked against `PIECE_CODES` in the tests, which is the part a type
 * cannot state.
 */
const CAPTURABLE_TYPES = ['r', 'n', 'c', 'a', 'b', 'p'] as const satisfies readonly Lowercase<Exclude<PieceCode, 'K' | 'k'>>[];

/** Black's pieces, which are the ones Red can have taken. */
const CAPTURED_BY_RED: PieceCode[] = [...CAPTURABLE_TYPES];
const CAPTURED_BY_BLACK: PieceCode[] = CAPTURABLE_TYPES.map((type) => type.toUpperCase() as PieceCode);

const PIECE_CODES = Object.keys(PIECE_VALUES_TENTHS) as PieceCode[];

export interface CapturedPiece {
    piece: PieceCode;
    count: number;
}

export interface MaterialSummary {
    /** Black pieces missing since the start position, so Red took them. */
    redCaptured: CapturedPiece[];
    blackCaptured: CapturedPiece[];
    /** Value of what Red has taken, in tenths of a soldier. */
    redMaterialTenths: number;
    blackMaterialTenths: number;
    /** Red's material on the board less Black's. Positive means Red is ahead. */
    deltaTenths: number;
}

/**
 * A piece named in words, side included, for the places a glyph will not do:
 * the capture tray's accessible label, where 車 alone tells a screen-reader
 * reader nothing about whose it was.
 */
export const PIECE_NAMES: Record<PieceCode, string> = {
    K: 'Red general',
    A: 'Red advisor',
    B: 'Red elephant',
    N: 'Red horse',
    R: 'Red chariot',
    C: 'Red cannon',
    P: 'Red soldier',
    k: 'Black general',
    a: 'Black advisor',
    b: 'Black elephant',
    n: 'Black horse',
    r: 'Black chariot',
    c: 'Black cannon',
    p: 'Black soldier',
};

/** Tenths of a pawn as the board shows them: whole numbers plain, the rest to one place. */
export function formatMaterialValue(valueTenths: number) {
    const value = valueTenths / 10;
    return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

/**
 * What one side has taken, spelled out. The tray shows glyphs, and the
 * per-piece title is a mouse-only tooltip on a generic span, so without this
 * the names never reach the accessibility tree at all.
 */
export function formatCapturedTrayLabel(
    side: 'Red' | 'Black',
    captured: Array<{ piece: PieceCode; count: number }>,
) {
    if (captured.length === 0) return `Pieces captured by ${side}: none`;
    const pieces = captured.map(({ piece, count }) => (
        count > 1 ? `${count} ${PIECE_NAMES[piece]}s` : PIECE_NAMES[piece]
    ));
    return `Pieces captured by ${side}: ${pieces.join(', ')}`;
}

export function isPieceCode(value: string): value is PieceCode {
    return Object.prototype.hasOwnProperty.call(PIECE_VALUES_TENTHS, value);
}

function countPieces(board: BoardState): Record<PieceCode, number> {
    const counts = PIECE_CODES.reduce((acc, code) => {
        acc[code] = 0;
        return acc;
    }, {} as Record<PieceCode, number>);
    for (const row of board) {
        for (const piece of row) {
            if (piece && isPieceCode(piece)) counts[piece] += 1;
        }
    }
    return counts;
}

/**
 * @param board the position now
 * @param startBoard the position the game began from — the root, not the
 *   standard opening set, which is the whole point
 */
export function summarizeMaterial(board: BoardState, startBoard: BoardState): MaterialSummary {
    const now = countPieces(board);
    const start = countPieces(startBoard);

    const captured = (pieces: PieceCode[]): CapturedPiece[] => pieces
        // A position can hold more of a piece than it started with only if the
        // start position was edited under it; count that as nothing taken
        // rather than as a negative haul.
        .map((piece) => ({ piece, count: Math.max(0, start[piece] - now[piece]) }))
        .filter((item) => item.count > 0);

    const valueOf = (items: CapturedPiece[]) => items.reduce(
        (sum, item) => sum + PIECE_VALUES_TENTHS[item.piece] * item.count,
        0
    );

    const onBoard = (isRed: boolean) => PIECE_CODES.reduce(
        (sum, code) => (code === code.toUpperCase()) === isRed
            ? sum + PIECE_VALUES_TENTHS[code] * now[code]
            : sum,
        0
    );

    const redCaptured = captured(CAPTURED_BY_RED);
    const blackCaptured = captured(CAPTURED_BY_BLACK);

    return {
        redCaptured,
        blackCaptured,
        redMaterialTenths: valueOf(redCaptured),
        blackMaterialTenths: valueOf(blackCaptured),
        deltaTenths: onBoard(true) - onBoard(false),
    };
}
