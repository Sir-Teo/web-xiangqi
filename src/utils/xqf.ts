/**
 * XQF, the file format of 象棋演播室 (XQStudio) and 象棋桥, and the one most
 * xiangqi records on disk are in. Every Chinese database exports it, every
 * desktop GUI reads it, and this app could not.
 *
 * Written from the published XQF 1.0 description (qipaile.net, 2001) and
 * from the behaviour of the later versions as they are widely documented;
 * the arithmetic below is this module's own. What matters:
 *
 * - A 1024-byte header: `XQ`, a version byte, thirteen key bytes, then the
 *   32 piece positions and the length-prefixed text fields (title, event,
 *   players, ...), all in GB18030.
 * - A position is one byte, `x * 10 + y`, with `x` the file from the left
 *   and `y` the rank from the *bottom* with Red at the bottom -- which is
 *   this app's own frame, so `40` is Red's general on e0. `0xFF` is a piece
 *   not on the board. The 32 slots are Red's chariot, horse, elephant,
 *   advisor, general, advisor, elephant, horse, chariot, two cannons and
 *   five soldiers, then Black's in the same order.
 * - Records from offset 0x400: four bytes (from + 24, to + 32, flags, pad),
 *   an optional 32-bit comment length and the comment. The first record is
 *   the root and carries no move. In version 10 the length is always
 *   present and the flags are `0xF0` for "a move follows"; from version 11
 *   the bytes are obscured with keys derived from the header, the flags are
 *   0x80 (next), 0x40 (variation) and 0x20 (comment), and the comment
 *   length carries an offset of its own.
 *
 * Variations are read: a record's "variation" flag means a sibling from the
 * same parent position, and a study saved from a GUI is full of them.
 */
import type { SerializableMoveTreeNode } from '../hooks/useXiangqi';
import { boardToFen, cloneBoardState, pieceSide, validatePieceMove, START_FEN, type BoardState, type Side } from './xiangqi';

const HEADER_SIZE = 0x400;
const FROM_OFFSET = 0x18;
const TO_OFFSET = 0x20;

/** The 32 slots of the header's board, in order. */
const SLOT_PIECES = 'RNBAKABNRCCPPPPPrnbakabnrccppppp';

export type XqfResult = 'red' | 'black' | 'draw' | 'unknown';

export interface XqfRecord {
    version: number;
    title?: string;
    event?: string;
    date?: string;
    site?: string;
    redPlayer?: string;
    blackPlayer?: string;
    result: XqfResult;
    /** Set only when the record starts somewhere other than the opening array. */
    startFen?: string;
    /** The main line, which is the first move at every branch. */
    moves: string[];
    /** The original first-child line reached its written end without recovery. */
    mainLineComplete: boolean;
    /** The whole game, variations and notes included. */
    moveTree: SerializableMoveTreeNode[];
    /** The note on the position before the first move, if any. */
    rootComment?: string;
    /** Moves the file held that the rules refused; the tree stops there. */
    refused: number;
}

interface Keys {
    keyXY: number;
    keyXYf: number;
    keyXYt: number;
    keyRMKSize: number;
    stream: Uint8Array;
}

/** `xy` as one byte to a square, or null off the board. */
function squareFromByte(value: number): string | null {
    if (value > 89) return null;
    const x = Math.floor(value / 10);
    const y = value % 10;
    if (x > 8) return null;
    return `${'abcdefghi'[x]}${y}`;
}

/** The mixing every key goes through; the multiplier is what differs. */
function mix(seed: number, multiplier: number): number {
    return ((((((seed * seed) * 3 + 9) * 3 + 8) * 2 + 1) * 3 + 8) * multiplier) & 0xff;
}

function deriveKeys(header: Uint8Array): Keys {
    const keyMask = header[3];
    const orA = header[8];
    const orB = header[9];
    const orC = header[10];
    const orD = header[11];
    const keysSum = header[12];
    const headXY = header[13];
    const headXYf = header[14];
    const headXYt = header[15];

    const keyXY = mix(headXY, headXY);
    const keyXYf = mix(headXYf, keyXY);
    const keyXYt = mix(headXYt, keyXYf);
    const keyRMKSize = (((keysSum * 256 + headXY) % 32000) + 767) & 0xffff;

    const b = [
        (keysSum & keyMask) | orA,
        (headXY & keyMask) | orB,
        (headXYf & keyMask) | orC,
        (headXYt & keyMask) | orD,
    ];
    const seed = '[(C) Copyright Mr. Dong Shiwei.]';
    const stream = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) stream[i] = seed.charCodeAt(i) & b[i % 4];
    return { keyXY, keyXYf, keyXYt, keyRMKSize, stream };
}

function decodeText(bytes: Uint8Array): string {
    try {
        return new TextDecoder('gb18030').decode(bytes).replace(/\0+$/g, '').trim();
    } catch {
        return new TextDecoder().decode(bytes).replace(/\0+$/g, '').trim();
    }
}

/** A length-prefixed GB18030 string at `offset`, bounded by `capacity` bytes. */
function textField(header: Uint8Array, offset: number, capacity: number): string | undefined {
    const length = Math.min(header[offset], capacity);
    if (length === 0) return undefined;
    const text = decodeText(header.subarray(offset + 1, offset + 1 + length));
    return text || undefined;
}

function boardFromHeader(header: Uint8Array, version: number, keys: Keys | null): BoardState | null {
    const raw = header.subarray(0x10, 0x30);
    const slots = new Uint8Array(32);
    if (!keys) {
        slots.set(raw);
    } else {
        for (let i = 0; i < 32; i += 1) {
            const target = version >= 12 ? (keys.keyXY + i + 1) & 0x1f : i;
            slots[target] = raw[i];
        }
        for (let i = 0; i < 32; i += 1) {
            const value = (slots[i] - keys.keyXY) & 0xff;
            slots[i] = value > 89 ? 0xff : value;
        }
    }

    const board: BoardState = Array.from({ length: 10 }, () => Array(9).fill(''));
    for (let slot = 0; slot < 32; slot += 1) {
        const value = slots[slot];
        if (value === 0xff) continue;
        const x = Math.floor(value / 10);
        const y = value % 10;
        if (x > 8 || y > 9) return null;
        if (board[y][x]) return null;
        board[y][x] = SLOT_PIECES[slot];
    }
    if (board.flat().filter((piece) => piece === 'K').length !== 1) return null;
    if (board.flat().filter((piece) => piece === 'k').length !== 1) return null;
    return board;
}

class Records {
    private offset = 0;
    private readonly bytes: Uint8Array;
    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
    }

    get remaining() { return this.bytes.length - this.offset; }

    take(count: number): Uint8Array | null {
        if (this.offset + count > this.bytes.length) return null;
        const out = this.bytes.subarray(this.offset, this.offset + count);
        this.offset += count;
        return out;
    }

    int32(): number | null {
        const b = this.take(4);
        if (!b) return null;
        return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
    }
}

interface Step {
    from: number;
    to: number;
    hasNext: boolean;
    hasVariation: boolean;
    comment?: string;
    complete: boolean;
}

/** One record, decoded for the version; null at the end of the data. */
function readStep(records: Records, version: number, keys: Keys | null, decodeComment = true): Step | null {
    const head = records.take(4);
    if (!head) return null;
    let from: number;
    let to: number;
    let hasNext: boolean;
    let hasVariation: boolean;
    let commentLength = 0;
    let complete = true;

    if (version <= 10 || !keys) {
        hasNext = (head[2] & 0xf0) !== 0;
        hasVariation = (head[2] & 0x0f) !== 0;
        const length = records.int32();
        if (length === null) complete = false;
        commentLength = length ?? 0;
        from = (head[0] - FROM_OFFSET) & 0xff;
        to = (head[1] - TO_OFFSET) & 0xff;
    } else {
        const flags = head[2] & 0xe0;
        hasNext = (flags & 0x80) !== 0;
        hasVariation = (flags & 0x40) !== 0;
        if (flags & 0x20) {
            const length = records.int32();
            commentLength = length === null ? 0 : (length - keys.keyRMKSize) | 0;
            if (length === null || commentLength < 0) complete = false;
        }
        from = (head[0] - FROM_OFFSET - keys.keyXYf) & 0xff;
        to = (head[1] - TO_OFFSET - keys.keyXYt) & 0xff;
    }

    let comment: string | undefined;
    if (commentLength > 0) {
        if (commentLength > records.remaining) complete = false;
        const bytes = records.take(Math.min(commentLength, records.remaining));
        if (bytes && decodeComment) comment = decodeText(bytes) || undefined;
    }
    return { from, to, hasNext, hasVariation, comment, complete };
}

/** A caller's capacity limit was exceeded before constructing a move tree. */
export class XqfMoveLimitError extends Error {
    constructor(maxNodes: number) {
        super(`XQF file is too large. Import ${maxNodes} moves or fewer across all variations.`);
        this.name = 'XqfMoveLimitError';
    }
}

/** Count reachable records, including refused branches, without checking moves. */
function checkMoveLimit(body: Uint8Array, version: number, keys: Keys | null, maxNodes: number): void {
    const records = new Records(body);
    const root = readStep(records, version, keys, false);
    let pending = root?.hasNext ? 1 : 0;
    let count = 0;
    while (pending > 0) {
        const step = readStep(records, version, keys, false);
        if (!step) break;
        if (++count > maxNodes) throw new XqfMoveLimitError(maxNodes);
        pending -= 1;
        if (step.hasNext) pending += 1;
        if (step.hasVariation) pending += 1;
    }
}

/** Whether the bytes are an XQF file at all. */
export function isXqfFile(bytes: Uint8Array): boolean {
    return bytes.length >= HEADER_SIZE && bytes[0] === 0x58 && bytes[1] === 0x51;
}

/**
 * Read a file. Null when it is not one, or its position cannot be placed.
 * A finite maxNodes counts moves across all branches before tree construction
 * and throws XqfMoveLimitError when the caller cannot support that many.
 *
 * Moves are checked against the rules as the tree is built, from the
 * position each was played in, and a branch stops at the first move the
 * rules refuse: a file this app wrote by hand for a test, or one damaged in
 * transit, produces a shorter game and a count rather than an illegal
 * board. Who moves first is not written down; it is the side of the piece
 * the first move moves, and Red when there is no move.
 */
export function parseXqf(bytes: Uint8Array, maxNodes = Number.POSITIVE_INFINITY): XqfRecord | null {
    if (!isXqfFile(bytes)) return null;
    const header = bytes.subarray(0, HEADER_SIZE);
    const version = header[2];
    const keys = version <= 10 ? null : deriveKeys(header);
    const board = boardFromHeader(header, version, keys);
    if (!board) return null;

    let body = bytes.subarray(HEADER_SIZE);
    if (keys) {
        const decoded = new Uint8Array(body.length);
        for (let i = 0; i < body.length; i += 1) {
            decoded[i] = (body[i] - keys.stream[(HEADER_SIZE + i) % 32]) & 0xff;
        }
        body = decoded;
    }
    if (Number.isFinite(maxNodes)) checkMoveLimit(body, version, keys, maxNodes);
    const records = new Records(body);

    // The root record: no move of its own, a note and whether anything follows.
    const root = readStep(records, version, keys);
    const rootComment = root?.comment;
    let mainLineComplete = root?.complete ?? false;

    let refused = 0;
    const startBoard = cloneBoardState(board);
    let firstMoverSide: Side | null = null;

    // The stream is depth-first: a child precedes its parent's next sibling.
    // Explicit frames keep long lines off the JS call stack, and only pending
    // siblings need to retain older board positions.
    type Frame = {
        parentBoard: BoardState;
        parentSide: Side | null;
        depth: number;
        discarded: boolean;
        onMainLine: boolean;
        siblings: SerializableMoveTreeNode[];
        owner?: SerializableMoveTreeNode;
    };
    const moveTree: SerializableMoveTreeNode[] = [];
    const pending: Frame[] = root?.hasNext ? [{
        parentBoard: startBoard, parentSide: null, depth: 0,
        discarded: false, onMainLine: true, siblings: moveTree,
    }] : [];
    while (pending.length) {
        const frame = pending.pop()!;
        const { parentBoard, parentSide, depth, discarded, onMainLine, siblings, owner } = frame;
        const step = readStep(records, version, keys);
        if (!step) {
            if (onMainLine) mainLineComplete = false;
            continue;
        }
        const fromSquare = squareFromByte(step.from);
        const toSquare = squareFromByte(step.to);
        let node: SerializableMoveTreeNode | null = null;
        let nextBoard: BoardState | null = null;
        let nextSide: Side | null = null;
        // Descendants of refused moves cannot be kept. Consume their records
        // but do not validate moves or clone boards for an unreachable branch.
        if (!discarded && fromSquare && toSquare) {
            const fromFile = fromSquare.charCodeAt(0) - 97;
            const fromRank = Number(fromSquare[1]);
            const toFile = toSquare.charCodeAt(0) - 97;
            const toRank = Number(toSquare[1]);
            const mover = parentSide ?? pieceSide(parentBoard[fromRank]?.[fromFile] ?? '');
            if (mover) {
                const result = validatePieceMove(parentBoard, { fromFile, fromRank, toFile, toRank, raw: `${fromSquare}${toSquare}` }, mover);
                if (result.ok) {
                    if (firstMoverSide === null && depth === 0) firstMoverSide = mover;
                    nextBoard = cloneBoardState(parentBoard);
                    nextBoard[toRank][toFile] = result.piece ?? '';
                    nextBoard[fromRank][fromFile] = '';
                    nextSide = mover === 'w' ? 'b' : 'w';
                    node = { uci: `${fromSquare}${toSquare}`, ...(step.comment ? { comment: step.comment } : {}) };
                }
            }
        }
        if (!node && !discarded) refused += 1;
        if (onMainLine && (!node || !step.complete)) mainLineComplete = false;
        if (node) {
            siblings.push(node);
            // Do not add an empty children array if every child is refused.
            if (owner) owner.children = siblings;
        }
        if (step.hasVariation) pending.push({ ...frame, onMainLine: false });
        if (step.hasNext) pending.push({
            parentBoard: nextBoard ?? parentBoard,
            parentSide: nextSide ?? parentSide,
            depth: depth + 1, discarded: discarded || !node, onMainLine,
            siblings: [], ...(node ? { owner: node } : {}),
        });
    }

    const moves: string[] = [];
    let cursor = moveTree;
    while (cursor.length > 0) {
        moves.push(cursor[0].uci);
        cursor = cursor[0].children ?? [];
    }

    const sideToMove: Side = firstMoverSide ?? 'w';
    const isStandardStart = boardToFen(board, 'w') === `${START_FEN} w - - 0 1` && sideToMove === 'w';
    const resultByte = header[0x33];
    const result: XqfResult = resultByte === 1 ? 'red' : resultByte === 2 ? 'black' : resultByte === 3 ? 'draw' : 'unknown';

    return {
        version,
        title: textField(header, 0x50, 63),
        event: textField(header, 0xd0, 63),
        date: textField(header, 0x110, 15),
        site: textField(header, 0x120, 15),
        redPlayer: textField(header, 0x130, 15),
        blackPlayer: textField(header, 0x140, 15),
        result,
        ...(isStandardStart ? {} : { startFen: boardToFen(board, sideToMove) }),
        moves,
        mainLineComplete,
        moveTree,
        ...(rootComment ? { rootComment } : {}),
        refused,
    };
}
