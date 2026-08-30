import { legalMovesFrom, parseMove, pieceSide, squareToUci, type BoardState, type Side } from './xiangqi';

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

/**
 * The position a recorded move was played in.
 *
 * A record stores the board *after* the move together with whatever it
 * captured, so the position before it is the two put back -- the same trick
 * `getMovePhaseForRecord` uses, and for the same reason: no replay is needed to
 * answer a question about one move.
 */
export function boardBeforeRecord(record: {
    uci: string;
    piece: string;
    captured?: string;
    board: BoardState;
}): BoardState | null {
    const move = parseMove(record.uci);
    if (!move) return null;
    const before = record.board.map((row) => row.slice());
    before[move.fromRank][move.fromFile] = record.piece;
    before[move.toRank][move.toFile] = record.captured || '';
    return before;
}

/** A recorded move, written in the requested style. */
export function formatRecordInStyle(
    record: { uci: string; piece: string; captured?: string; board: BoardState },
    style: XiangqiNotationStyle
): string {
    if (style === 'uci') return record.uci.toUpperCase();
    const before = boardBeforeRecord(record);
    if (!before) return record.uci.toUpperCase();
    return formatMoveInStyle(before, record.uci, style);
}

/** Move the piece and clear the source. The caller supplies legal moves. */
function applyMoveUnchecked(state: BoardState, uci: string): BoardState | null {
    const move = parseMove(uci);
    if (!move) return null;
    const piece = state[move.fromRank]?.[move.fromFile];
    if (!piece) return null;
    const next = state.map((row) => row.slice());
    next[move.toRank][move.toFile] = piece;
    next[move.fromRank][move.fromFile] = '';
    return next;
}

/**
 * A principal variation, written in the requested style.
 *
 * Every move after the first is played on a board the earlier ones have
 * already changed, so a line has to be replayed rather than formatted move by
 * move against the starting position: which chariot is the front one, and
 * whether a file number needs disambiguating at all, both change as the line
 * runs. Replay stops at the first move that will not apply, and what has been
 * formatted so far is kept -- a line the app cannot follow is still worth
 * showing as far as it goes.
 */
export function formatLineInStyle(
    board: BoardState,
    moves: string[],
    style: XiangqiNotationStyle,
    maxMoves = 7
): string {
    const visible = moves.slice(0, maxMoves);
    const parts: string[] = [];
    let state: BoardState | null = board;

    for (const uci of visible) {
        if (style === 'uci' || !state) {
            parts.push(uci.toUpperCase());
            continue;
        }
        parts.push(formatMoveInStyle(state, uci, style));
        state = applyMoveUnchecked(state, uci);
    }

    const remaining = moves.length - visible.length;
    const text = parts.join(' ');
    return remaining > 0 ? `${text} +${remaining}` : text;
}

/**
 * Reading a move back.
 *
 * The parser is the formatter run backwards, literally: it generates the legal
 * moves in the position and asks which one *writes* as the text it was given.
 * That is a few dozen formats per token, which is nothing, and it buys two
 * things a hand-written parser cannot. It can never accept an illegal move,
 * because it only ever offers legal ones. And it can never disagree with the
 * formatter about what a move is called, because it is asking the formatter.
 *
 * `canonicaliseNotationToken` is what makes the comparison lenient enough to
 * be useful on a real record. It folds the differences that are spelling
 * rather than meaning:
 *
 * - **Simplified against traditional**, and the red/black glyph split. Records
 *   write 车马炮 for both sides where this app draws 俥傌炮 and 車馬砲; all of
 *   them mean the same piece, and the side to move already says which one.
 * - **Chinese numerals against Arabic.** The convention is Chinese for red and
 *   Arabic for black, but a record that mixes them is still readable.
 * - **`.` against `=`** for a traverse, both of which WXF allows.
 * - **Case**, and full-width digits, which paste in from Chinese sources.
 *
 * Both notations fold to the same shape for most moves -- `C2=5` and 炮二平五
 * both become `C2=5` -- but not for soldiers stacked three deep, where WXF
 * drops the letter and Chinese does not. So a candidate is compared against
 * its own form in each notation rather than against one canonical form.
 */

/** Every spelling of a piece that means the same piece. */
const PIECE_TOKEN_ALIASES: Record<string, string> = {
    // General
    K: 'K', G: 'K', 帥: 'K', 帅: 'K', 將: 'K', 将: 'K',
    // Advisor
    A: 'A', 仕: 'A', 士: 'A',
    // Elephant -- B is the FEN letter, which a UCI-minded reader may reach for.
    E: 'E', B: 'E', 相: 'E', 象: 'E',
    // Horse -- N likewise.
    H: 'H', N: 'H', 傌: 'H', 馬: 'H', 马: 'H',
    // Chariot
    R: 'R', 俥: 'R', 車: 'R', 车: 'R',
    // Cannon -- 包 turns up in older records.
    C: 'C', 炮: 'C', 砲: 'C', 包: 'C',
    // Soldier
    P: 'P', S: 'P', 兵: 'P', 卒: 'P',
};

const ACTION_TOKEN_ALIASES: Record<string, string> = {
    '+': '+', '＋': '+', 進: '+', 进: '+',
    '-': '-', '－': '-', '−': '-', 退: '-',
    '=': '=', '＝': '=', '.': '=', '．': '=', 平: '=',
};

/** Front, middle and rear, which double as the stack markers. */
const STACK_TOKEN_ALIASES: Record<string, string> = {
    前: '+', 後: '-', 后: '-', 中: 'M',
};

const DIGIT_TOKEN_ALIASES: Record<string, string> = {
    一: '1', 二: '2', 三: '3', 四: '4', 五: '5',
    六: '6', 七: '7', 八: '8', 九: '9',
    '１': '1', '２': '2', '３': '3', '４': '4', '５': '5',
    '６': '6', '７': '7', '８': '8', '９': '9',
};

/**
 * One move token reduced to the spelling-independent form used for comparison.
 *
 * Returns null for anything that cannot be a move -- a move number, a result,
 * an annotation -- so a caller can walk a record's tokens and simply skip what
 * does not read as a move.
 */
export function canonicaliseNotationToken(text: string): string | null {
    const trimmed = String(text ?? '').trim();
    if (!trimmed || trimmed.length > 12) return null;

    let out = '';
    for (const char of trimmed) {
        if (char === ' ' || char === '　') continue;
        const upper = char.toUpperCase();
        const mapped =
            DIGIT_TOKEN_ALIASES[char] ??
            STACK_TOKEN_ALIASES[char] ??
            ACTION_TOKEN_ALIASES[char] ??
            PIECE_TOKEN_ALIASES[upper] ??
            (/^[1-9]$/.test(char) ? char : null);
        // `+` and `-` are both an action and a stack marker; the tables above
        // agree on them, so order does not matter.
        if (mapped === null) return null;
        out += mapped;
    }

    // A token has to have the *shape* of a move, not merely be built from
    // characters a move could contain. Without this, `2...` folds to `2===`
    // -- three traverse markers -- and a move number starts reading as a move.
    return MOVE_TOKEN_SHAPE.test(out) ? out : null;
}

/**
 * The five shapes a move can canonicalise to.
 *
 * The last two exist because WXF and Chinese order a stack marker and its file
 * differently: WXF writes `+P5+1`, Chinese writes 後九兵進一, which folds to
 * `-9P+1`. Both are one soldier of a stacked pair on a named file.
 */
const MOVE_TOKEN_SHAPE = new RegExp(
    '^(?:' + [
        '[KAEHRCP][1-9][+\\-=][1-9]',        // C2=5
        '[+\\-M][KAEHRCP][+\\-=][1-9]',      // +R+1
        '[+\\-M][KAEHRCP][1-9][+\\-=][1-9]', // +P5+1
        '[+\\-M][1-9][KAEHRCP][+\\-=][1-9]', // -9P+1
        '[1-9][1-9][+\\-=][1-9]',            // 35+1
    ].join('|') + ')$'
);

/**
 * The UCI move that `text` names in this position, or null.
 *
 * Accepts WXF, Chinese, and plain coordinates, so a caller does not have to
 * know which it was handed.
 */
export function parseMoveInNotation(
    board: BoardState,
    sideToMove: Side,
    text: string
): string | null {
    const raw = String(text ?? '').trim().toLowerCase();
    if (/^[a-i][0-9][a-i][0-9]$/.test(raw)) {
        // Coordinates still have to name a legal move, like everything else.
        return legalMovesInPosition(board, sideToMove).includes(raw) ? raw : null;
    }

    const wanted = canonicaliseNotationToken(text);
    if (!wanted) return null;

    for (const uci of legalMovesInPosition(board, sideToMove)) {
        const wxf = formatWxfMove(board, uci);
        if (wxf && canonicaliseNotationToken(wxf) === wanted) return uci;
        const chinese = formatChineseMove(board, uci);
        if (chinese && canonicaliseNotationToken(chinese) === wanted) return uci;
    }
    return null;
}

function legalMovesInPosition(board: BoardState, sideToMove: Side): string[] {
    const moves: string[] = [];
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            if (pieceSide(board[rank][file]) !== sideToMove) continue;
            for (const target of legalMovesFrom(board, file, rank, sideToMove)) {
                moves.push(squareToUci(file, rank) + squareToUci(target.file, target.rank));
            }
        }
    }
    return moves;
}

export interface ParsedNotationLine {
    moves: string[];
    /** Tokens that looked like moves but named none, in the order they appeared. */
    rejected: string[];
}

/**
 * Read a whole record, replaying as it goes.
 *
 * Each move has to be parsed against the position it was played in, so this
 * walks the text one token at a time and applies what it recognises. Anything
 * that is not a move in the position -- a move number, a result, a comment
 * word -- is skipped silently; a token that *reads* as a move but names none
 * is collected in `rejected`, because that is the case worth telling a user
 * about.
 */
export function parseMoveLineInNotation(
    board: BoardState,
    sideToMove: Side,
    text: string,
    maxMoves = 1024
): ParsedNotationLine {
    const moves: string[] = [];
    const rejected: string[] = [];
    let state = board;
    let side = sideToMove;

    for (const token of String(text ?? '').split(/[\s,;]+/)) {
        if (!token || moves.length >= maxMoves) break;
        const uci = parseMoveInNotation(state, side, token);
        if (!uci) {
            // Only complain about something that was shaped like a move.
            if (canonicaliseNotationToken(token)) rejected.push(token);
            continue;
        }
        const next = applyMoveUnchecked(state, uci);
        if (!next) break;
        moves.push(uci);
        state = next;
        side = side === 'w' ? 'b' : 'w';
    }

    return { moves, rejected };
}
