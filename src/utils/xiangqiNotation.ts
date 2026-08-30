import { parseMove, pieceSide, type BoardState, type Side } from './xiangqi';

/**
 * Xiangqi moves in the two notations players actually read.
 *
 * The app spoke UCI everywhere -- `h2e2` on the move list, in the engine's
 * principal variations, in the review and in the opening book. UCI is the wire
 * format and it is the right thing to store, but nobody reads xiangqi that way.
 * Every Chinese book, every database, every broadcast and the World Xiangqi
 * Federation's own records write the same move as 炮二平五 or `C2=5`, and a
 * player who knows the game reads "cannon to the middle file" from that at a
 * glance while `h2e2` makes them rebuild the board in their head.
 *
 * ## The rules encoded here
 *
 * **Files are numbered from each player's own right**, so the two sides
 * disagree about every file. Red's file 1 is `i`, so red's number is
 * `9 - fileIndex`; black's file 1 is `a`, so black's number is `fileIndex + 1`.
 * Both sides call the middle file 5, which is why the opening move above is
 * "two to five" for red and "8 to 5" for black.
 *
 * **The trailing number means two different things.** After `=` (traverse) it
 * is the file the piece lands on. After `+` or `-` it is the number of ranks
 * crossed -- but only for the pieces that move in a straight line (chariot,
 * cannon, soldier, general). The horse, elephant and advisor always move both
 * sideways and along the board at once, so for them the trailing number is the
 * destination *file*, and the sign only says which way along the board they
 * went. `H2+3` is a horse, so 3 is a file; `R2+3` is a chariot, so 3 is three
 * ranks.
 *
 * **Two of a kind on one file lose their file number** and take `+` for the
 * one nearer the opponent and `-` for the one behind it: `+R+1`, 前車進一.
 * Only soldiers can stack more than two deep, and then the piece letter is
 * dropped instead and they are counted from the front: `35+1` is "the third
 * soldier on file 5 advances one".
 *
 * ## Where this deviates, and why
 *
 * Two files can each hold a stacked pair, and then `+R+1` names two different
 * moves. WXF has no answer for that because it is vanishingly rare over the
 * board; this module keeps the file number in that case (`+R2+1`) rather than
 * emit something ambiguous. `formatsEveryLegalMoveDistinctly` in the test file
 * is what holds that line: it walks every legal move in a position and asserts
 * no two produce the same string.
 *
 * The Chinese output uses the same glyphs as the board (俥傌炮 for red, 車馬砲
 * for black) rather than the single-glyph set some publications use, so a
 * beginner can match a character in the move list to the piece under their
 * finger. The numerals follow the standard: Chinese for red, Arabic for black.
 */

export type XiangqiNotationStyle = 'uci' | 'wxf' | 'chinese';

export const NOTATION_STYLES: XiangqiNotationStyle[] = ['uci', 'wxf', 'chinese'];

export function isNotationStyle(value: unknown): value is XiangqiNotationStyle {
    return value === 'uci' || value === 'wxf' || value === 'chinese';
}

export const NOTATION_STYLE_LABELS: Record<XiangqiNotationStyle, string> = {
    uci: 'UCI',
    wxf: 'WXF',
    chinese: '中文',
};

export const NOTATION_STYLE_DESCRIPTIONS: Record<XiangqiNotationStyle, string> = {
    uci: 'Coordinates the engine uses, such as h2e2.',
    wxf: 'World Xiangqi Federation letters, such as C2=5.',
    chinese: 'Chinese move records, such as 炮二平五.',
};

/** WXF piece letters. Note E for elephant and H for horse, not B and N. */
const WXF_LETTERS: Record<string, string> = {
    K: 'K', A: 'A', B: 'E', N: 'H', R: 'R', C: 'C', P: 'P',
};

/** Matches the glyphs the board draws, so the two can be read against each other. */
const CHINESE_PIECES: Record<string, string> = {
    K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵',
    k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
};

const RED_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** Chariot, cannon, soldier and general travel in a straight line. */
const STRAIGHT_MOVERS = new Set(['R', 'C', 'P', 'K']);

/** How many soldiers deep a stack has to be before they are counted, not signed. */
const STACK_COUNTED_FROM = 3;

const CHINESE_STACK_LABELS: Record<number, string[]> = {
    2: ['前', '後'],
    3: ['前', '中', '後'],
};

/** A file's number in the mover's own numbering, which runs from their right. */
export function fileNumberFor(side: Side, fileIndex: number): number {
    return side === 'w' ? 9 - fileIndex : fileIndex + 1;
}

/** The rank step that counts as forward for this side. */
function forwardStep(side: Side): number {
    return side === 'w' ? 1 : -1;
}

function numeral(side: Side, value: number): string {
    if (side === 'b') return String(value);
    return RED_NUMERALS[value - 1] ?? String(value);
}

/**
 * Every piece of this side and type standing on `file`, ordered from the one
 * nearest the opponent to the one furthest back.
 */
function stackOnFile(board: BoardState, piece: string, file: number): number[] {
    const side = pieceSide(piece);
    if (!side) return [];
    const ranks: number[] = [];
    for (let rank = 0; rank < 10; rank += 1) {
        if (board[rank]?.[file] === piece) ranks.push(rank);
    }
    // Red advances up the ranks, so its front piece has the highest rank.
    return side === 'w' ? ranks.sort((a, b) => b - a) : ranks.sort((a, b) => a - b);
}

/** How many files carry a stack of this piece -- see the note on `+R2+1`. */
function stackedFileCount(board: BoardState, piece: string): number {
    let count = 0;
    for (let file = 0; file < 9; file += 1) {
        if (stackOnFile(board, piece, file).length > 1) count += 1;
    }
    return count;
}

interface MoveShape {
    piece: string;
    side: Side;
    type: string;
    fromFile: number;
    fromRank: number;
    toFile: number;
    toRank: number;
    /** Position in the file's stack counting from the front, or -1 when alone. */
    stackIndex: number;
    stackSize: number;
    /** Whether the file number has to be kept alongside a stack marker. */
    needsFileWithMarker: boolean;
}

function readMoveShape(board: BoardState, uci: string): MoveShape | null {
    const move = parseMove(uci);
    if (!move) return null;
    const piece = board[move.fromRank]?.[move.fromFile];
    if (!piece) return null;
    const side = pieceSide(piece);
    if (!side) return null;

    const stack = stackOnFile(board, piece, move.fromFile);
    const stackIndex = stack.indexOf(move.fromRank);
    return {
        piece,
        side,
        type: piece.toUpperCase(),
        fromFile: move.fromFile,
        fromRank: move.fromRank,
        toFile: move.toFile,
        toRank: move.toRank,
        stackIndex,
        stackSize: stack.length,
        needsFileWithMarker: stack.length > 1 && stackedFileCount(board, piece) > 1,
    };
}

/** '=' sideways, '+' toward the opponent, '-' back toward home. */
function actionSign(shape: MoveShape): '=' | '+' | '-' {
    if (shape.toRank === shape.fromRank) return '=';
    return (shape.toRank - shape.fromRank) * forwardStep(shape.side) > 0 ? '+' : '-';
}

/**
 * The trailing number: a destination file after a traverse and for the pieces
 * that move diagonally, a distance for everything else.
 */
function targetValue(shape: MoveShape, sign: '=' | '+' | '-'): number {
    if (sign === '=' || !STRAIGHT_MOVERS.has(shape.type)) {
        return fileNumberFor(shape.side, shape.toFile);
    }
    return Math.abs(shape.toRank - shape.fromRank);
}

export function formatWxfMove(board: BoardState, uci: string): string | null {
    const shape = readMoveShape(board, uci);
    if (!shape) return null;

    const letter = WXF_LETTERS[shape.type];
    if (!letter) return null;

    const sign = actionSign(shape);
    const target = String(targetValue(shape, sign));
    const fileNumber = String(fileNumberFor(shape.side, shape.fromFile));

    if (shape.stackSize < 2) return `${letter}${fileNumber}${sign}${target}`;

    // Three soldiers deep: the letter goes, and they are counted from the front.
    if (shape.stackSize >= STACK_COUNTED_FROM) {
        return `${shape.stackIndex + 1}${fileNumber}${sign}${target}`;
    }

    const marker = shape.stackIndex === 0 ? '+' : '-';
    const file = shape.needsFileWithMarker ? fileNumber : '';
    return `${marker}${letter}${file}${sign}${target}`;
}

export function formatChineseMove(board: BoardState, uci: string): string | null {
    const shape = readMoveShape(board, uci);
    if (!shape) return null;

    const glyph = CHINESE_PIECES[shape.piece];
    if (!glyph) return null;

    const sign = actionSign(shape);
    const action = sign === '=' ? '平' : sign === '+' ? '進' : '退';
    const target = numeral(shape.side, targetValue(shape, sign));
    const fileNumeral = numeral(shape.side, fileNumberFor(shape.side, shape.fromFile));

    if (shape.stackSize < 2) return `${glyph}${fileNumeral}${action}${target}`;

    const labels = CHINESE_STACK_LABELS[shape.stackSize];
    // Four and five deep run out of 前中後 and are counted from the front.
    const marker = labels?.[shape.stackIndex] ?? numeral('w', shape.stackIndex + 1);
    const file = shape.needsFileWithMarker ? fileNumeral : '';
    return `${marker}${file}${glyph}${action}${target}`;
}

export function formatMoveInStyle(
    board: BoardState,
    uci: string,
    style: XiangqiNotationStyle
): string {
    if (style === 'wxf') return formatWxfMove(board, uci) ?? uci.toUpperCase();
    if (style === 'chinese') return formatChineseMove(board, uci) ?? uci.toUpperCase();
    return uci.toUpperCase();
}
