/**
 * DhtmlXQ, the record format of 东萍象棋 (dpxq.com) and the one a Chinese
 * player is most likely to paste: every game page on that site, and many
 * forum posts, carry a block of `[DhtmlXQ_...]` tags with the whole game in
 * them. Nothing here read it, so the largest online xiangqi archive was a
 * paste that imported as nothing.
 *
 * The format, read off the records rather than a specification, since there
 * is none published:
 *
 * - `[DhtmlXQ_movelist]` is the moves, four digits each and run together:
 *   `2625` is from (2,6) to (2,5). `x` counts files 0-8 from the left with Red
 *   at the bottom, `y` counts ranks 0-9 from the *top*, so (2,6) is c3 and
 *   `2625` is the soldier c3-c4, 兵七进一 -- the most played first move.
 * - `[DhtmlXQ_binit]` is the start position: 32 pieces in a fixed order, two
 *   digits of `xy` each, `99` for a piece that is not on the board. The order
 *   is Red then Black, each as chariot, horse, elephant, advisor, general,
 *   advisor, elephant, horse, chariot, cannon, cannon, five soldiers; the
 *   standard opening array is the string every full game carries.
 * - `[DhtmlXQ_comment<n>]` is a note on move `n`, counted from 1; `comment0`
 *   is about the position before the first move. Line breaks are `||`.
 *
 * Variations live in `[DhtmlXQ_movelist<n>]` tags with their own numbering
 * and are not read: the main line is what a paste is for.
 */
import { boardToFen, parseFenBoard, pieceSide, START_FEN, type BoardState, type Side } from './xiangqi';

/** The 32 slots of `binit`, in order. */
const BINIT_PIECES = [
    'R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P',
    'r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r', 'c', 'c', 'p', 'p', 'p', 'p', 'p',
] as const;

/** The opening array as `binit` writes it; a record carrying this starts from the usual place. */
export const DHTMLXQ_START_BINIT = '8979695949392919097717866646260600102030405060708012720323436383';

export interface DhtmlXqRecord {
    /** UCI moves of the main line, in order. */
    moves: string[];
    /** Set only when the record starts somewhere other than the opening array. */
    startFen?: string;
    /** Notes keyed by move number, 1-based; 0 is the note before the game. */
    comments: Map<number, string>;
    /** The title tag, when the record carries one. */
    title?: string;
}

const FILES = 'abcdefghi';

function tagValue(text: string, name: string): string | null {
    const opening = new RegExp(`\\[DhtmlXQ_${name}\\]`, 'i').exec(text);
    if (!opening) return null;
    const contentStart = opening.index + opening[0].length;
    const closing = new RegExp(`\\[/DhtmlXQ_${name}\\]`, 'gi');
    closing.lastIndex = contentStart;
    const end = closing.exec(text);
    // Searching for the closer once avoids retrying the entire suffix at every
    // opener. Regex case matching also preserves offsets around Unicode text.
    return end ? text.slice(contentStart, end.index).trim() : null;
}

/** `xy` in the record's frame to a UCI square, or null off the board. */
function squareFromDigits(x: number, y: number): string | null {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 8 || y < 0 || y > 9) return null;
    return `${FILES[x]}${9 - y}`;
}

/** Whether the text is a DhtmlXQ record at all. */
export function isDhtmlXqRecord(text: string): boolean {
    return /\[DhtmlXQ_(?:movelist|binit)\]/i.test(text);
}

/**
 * The board `binit` describes, or null when the string is not one.
 *
 * Two generals are required, because a board without them is not a position
 * a game can be played from and the app's FEN reader refuses it anyway; the
 * rest of the legality check -- palaces, facing generals, a check against the
 * side not to move -- is the reader's, applied when the position is loaded.
 */
export function boardFromBinit(binit: string): BoardState | null {
    const digits = binit.replace(/\s+/g, '');
    if (!/^\d{64}$/.test(digits)) return null;
    const board: BoardState = Array.from({ length: 10 }, () => Array(9).fill(''));
    for (let slot = 0; slot < 32; slot += 1) {
        const x = Number(digits[slot * 2]);
        const y = Number(digits[slot * 2 + 1]);
        if (x === 9 && y === 9) continue;
        if (x > 8 || y > 9) return null;
        const rank = 9 - y;
        if (board[rank][x]) return null;
        board[rank][x] = BINIT_PIECES[slot];
    }
    if (board.flat().filter((piece) => piece === 'K').length !== 1) return null;
    if (board.flat().filter((piece) => piece === 'k').length !== 1) return null;
    return board;
}

/** The moves in a `movelist`, as UCI; stops at the first pair that is not a square. */
export function movesFromMovelist(movelist: string): string[] {
    const digits = movelist.replace(/\s+/g, '');
    const moves: string[] = [];
    for (let index = 0; index + 4 <= digits.length; index += 4) {
        const from = squareFromDigits(Number(digits[index]), Number(digits[index + 1]));
        const to = squareFromDigits(Number(digits[index + 2]), Number(digits[index + 3]));
        if (!from || !to || from === to) break;
        moves.push(`${from}${to}`);
    }
    return moves;
}

/** Notes, with the site's `||` line breaks folded back to newlines. */
function commentsFromRecord(text: string): Map<number, string> {
    const comments = new Map<number, string>();
    // Index closers once. A missing closer must not cause a fresh suffix scan
    // for every opening comment, including openings with different numbers.
    const closers = new Map<string, { cursor: number; positions: Array<{ start: number; end: number }> }>();
    for (const match of text.matchAll(/\[\/DhtmlXQ_comment(\d+)\]/gi)) {
        let entries = closers.get(match[1]);
        if (!entries) { entries = { cursor: 0, positions: [] }; closers.set(match[1], entries); }
        entries.positions.push({ start: match.index, end: match.index + match[0].length });
    }
    const opening = /\[DhtmlXQ_comment(\d+)\]/gi;
    let match: RegExpExecArray | null;
    while ((match = opening.exec(text))) {
        const entries = closers.get(match[1]);
        if (!entries) continue;
        while (entries.cursor < entries.positions.length && entries.positions[entries.cursor].start < opening.lastIndex) entries.cursor++;
        const end = entries.positions[entries.cursor];
        if (!end) continue;
        const body = text.slice(opening.lastIndex, end.start).replace(/\|\|/g, '\n').trim();
        if (body) comments.set(Number(match[1]), body);
        // Preserve the old non-overlapping, outer-first matching behavior.
        opening.lastIndex = end.end;
        entries.cursor++;
    }
    return comments;
}

/**
 * Read a record. Null when the text is not one, or carries neither a
 * position nor a move; a record with a position and no moves is a diagram,
 * which is a thing this format is used for and worth loading.
 *
 * Who moves first is not written down. It is read off the first move: the
 * side of the piece it moves is the side to move. A diagram with no moves is
 * taken as Red to move, which is the convention of the site's endgame pages.
 */
export function parseDhtmlXqRecord(text: string): DhtmlXqRecord | null {
    if (!isDhtmlXqRecord(text)) return null;
    const binit = tagValue(text, 'binit');
    const movelist = tagValue(text, 'movelist');
    const moves = movelist ? movesFromMovelist(movelist) : [];

    let board: BoardState;
    let custom = false;
    if (binit && binit.replace(/\s+/g, '') !== DHTMLXQ_START_BINIT) {
        const parsed = boardFromBinit(binit);
        if (!parsed) return null;
        board = parsed;
        custom = true;
    } else {
        board = parseFenBoard(START_FEN);
    }
    const comments = commentsFromRecord(text);
    if (moves.length === 0 && !custom && !comments.get(0)?.trim()) return null;

    let sideToMove: Side = 'w';
    if (moves.length > 0) {
        const from = moves[0];
        const file = FILES.indexOf(from[0]);
        const rank = Number(from[1]);
        sideToMove = pieceSide(board[rank]?.[file] ?? '') ?? 'w';
    }

    const title = tagValue(text, 'title') ?? undefined;
    return {
        moves,
        ...(custom ? { startFen: boardToFen(board, sideToMove) } : {}),
        comments,
        ...(title ? { title } : {}),
    };
}
