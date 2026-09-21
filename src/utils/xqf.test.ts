import { describe, expect, it, vi } from 'vitest';
import { isXqfFile, parseXqf, XqfMoveLimitError } from './xqf';
import * as rules from './xiangqi';

/**
 * A writer, kept to the test: the reader is checked against files written
 * by 象棋桥 and XQStudio by hand (four of them, versions 10 and 18, one a
 * study with twelve variations), and those files are not this repo's to
 * ship. What the writer buys is a fixture that can say exactly what it
 * holds, and a round trip through the keyed versions, whose arithmetic is
 * the part a wrong reading would silently get wrong.
 */
const START_SLOTS = [80, 70, 60, 50, 40, 30, 20, 10, 0, 72, 12, 83, 63, 43, 23, 3, 9, 19, 29, 39, 49, 59, 69, 79, 89, 17, 77, 6, 26, 46, 66, 86];

function gb(text: string): Uint8Array {
    // The test strings are ASCII, which GB18030 shares with UTF-8.
    return new TextEncoder().encode(text);
}

function byteOf(square: string): number {
    return (square.charCodeAt(0) - 97) * 10 + Number(square[1]);
}

interface WriteStep {
    uci: string;
    comment?: string;
    children?: WriteStep[];
}

function mix(seed: number, multiplier: number): number {
    return ((((((seed * seed) * 3 + 9) * 3 + 8) * 2 + 1) * 3 + 8) * multiplier) & 0xff;
}

function writeXqf(options: {
    version: number;
    slots?: number[];
    title?: string;
    red?: string;
    black?: string;
    result?: number;
    rootComment?: string;
    tree: WriteStep[];
    keyBytes?: number[];
}): Uint8Array {
    const header = new Uint8Array(0x400);
    header[0] = 0x58; header[1] = 0x51; header[2] = options.version;
    const keyBytes = options.keyBytes ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    header.set(keyBytes.slice(0, 13), 3);
    const slots = options.slots ?? START_SLOTS;

    const keyXY = mix(header[13], header[13]);
    const keyXYf = mix(header[14], keyXY);
    const keyXYt = mix(header[15], keyXYf);
    const keyRMKSize = (((header[12] * 256 + header[13]) % 32000) + 767) & 0xffff;
    const keyed = options.version > 10;

    for (let i = 0; i < 32; i += 1) {
        const value = slots[i] === 0xff ? 0xff : slots[i];
        if (!keyed) { header[0x10 + i] = value; continue; }
        const stored = (value + keyXY) & 0xff;
        const target = options.version >= 12 ? (keyXY + i + 1) & 0x1f : i;
        // The reader unscrambles slot `target` back to `i`, so write i's value there.
        header[0x10 + (options.version >= 12 ? indexFor(keyXY, i) : i)] = stored;
        void target;
    }
    const put = (offset: number, text: string | undefined) => {
        if (!text) return;
        const bytes = gb(text);
        header[offset] = bytes.length;
        header.set(bytes, offset + 1);
    };
    put(0x50, options.title);
    put(0x130, options.red);
    put(0x140, options.black);
    header[0x33] = options.result ?? 0;

    const body: number[] = [];
    const int32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
    const record = (from: number, to: number, hasNext: boolean, hasVariation: boolean, comment?: string) => {
        const text = comment ? gb(comment) : new Uint8Array(0);
        if (!keyed) {
            body.push((from + 0x18) & 0xff, (to + 0x20) & 0xff, (hasNext ? 0xf0 : 0) | (hasVariation ? 0x01 : 0), 0, ...int32(text.length), ...text);
            return;
        }
        const flags = (hasNext ? 0x80 : 0) | (hasVariation ? 0x40 : 0) | (text.length ? 0x20 : 0);
        body.push((from + 0x18 + keyXYf) & 0xff, (to + 0x20 + keyXYt) & 0xff, flags, 0);
        if (text.length) body.push(...int32(text.length + keyRMKSize), ...text);
    };
    const writeSiblings = (steps: WriteStep[]) => {
        steps.forEach((step, index) => {
            record(byteOf(step.uci.slice(0, 2)), byteOf(step.uci.slice(2, 4)), Boolean(step.children?.length), index < steps.length - 1, step.comment);
            if (step.children?.length) writeSiblings(step.children);
        });
    };
    record(0, 0, options.tree.length > 0, false, options.rootComment);
    writeSiblings(options.tree);

    let bytes = Uint8Array.from(body);
    if (keyed) {
        const b = [
            (header[12] & header[3]) | header[8],
            (header[13] & header[3]) | header[9],
            (header[14] & header[3]) | header[10],
            (header[15] & header[3]) | header[11],
        ];
        const seed = '[(C) Copyright Mr. Dong Shiwei.]';
        const stream = Array.from({ length: 32 }, (_, i) => seed.charCodeAt(i) & b[i % 4]);
        bytes = bytes.map((value, i) => (value + stream[(0x400 + i) % 32]) & 0xff);
    }
    const out = new Uint8Array(header.length + bytes.length);
    out.set(header);
    out.set(bytes, header.length);
    return out;
}

/** The header slot the reader will read slot `i` back out of, at version 12+. */
function indexFor(keyXY: number, i: number): number {
    // The reader does slots[(keyXY + j + 1) & 0x1f] = raw[j], so raw index j
    // lands in slot (keyXY + j + 1) & 0x1f; invert it.
    for (let j = 0; j < 32; j += 1) if (((keyXY + j + 1) & 0x1f) === i) return j;
    throw new Error('unreachable');
}

const GAME: WriteStep[] = [{
    uci: 'h2e2',
    comment: 'Central cannon.',
    children: [
        { uci: 'h9g7', children: [{ uci: 'h0g2' }] },
        { uci: 'h7e7', comment: 'The same-direction cannon.' },
    ],
}];

describe('recognising a file', () => {
    it('needs the XQ signature and a whole header', () => {
        expect(isXqfFile(new TextEncoder().encode('XQ'))).toBe(false);
        expect(isXqfFile(writeXqf({ version: 10, tree: [] }))).toBe(true);
        expect(parseXqf(new TextEncoder().encode('[Event "x"] 1. h2e2'))).toBeNull();
    });
});

describe('a version 10 file, which is written in the clear', () => {
    const file = writeXqf({ version: 10, title: 'Test', red: 'Red Player', black: 'Black Player', result: 1, rootComment: 'Before.', tree: GAME });

    it('reads the header, the main line, the variation and the notes', () => {
        const record = parseXqf(file);
        expect(record?.version).toBe(10);
        expect(record?.title).toBe('Test');
        expect(record?.redPlayer).toBe('Red Player');
        expect(record?.blackPlayer).toBe('Black Player');
        expect(record?.result).toBe('red');
        expect(record?.rootComment).toBe('Before.');
        expect(record?.startFen).toBeUndefined();
        expect(record?.moves).toEqual(['h2e2', 'h9g7', 'h0g2']);
        expect(record?.moveTree).toEqual([{
            uci: 'h2e2',
            comment: 'Central cannon.',
            children: [
                { uci: 'h9g7', children: [{ uci: 'h0g2' }] },
                { uci: 'h7e7', comment: 'The same-direction cannon.' },
            ],
        }]);
        expect(record?.refused).toBe(0);
        expect(record?.mainLineComplete).toBe(true);
    });
});

describe('the keyed versions', () => {
    for (const version of [11, 12, 18]) {
        it(`round-trips version ${version} through the header keys`, () => {
            const file = writeXqf({
                version,
                title: 'Keyed',
                tree: GAME,
                keyBytes: [0x5a, 0, 0, 0, 0, 0x33, 0x0f, 0x71, 0x2c, 0x91, 0x47, 0x88, 0x19],
            });
            const record = parseXqf(file);
            expect(record?.version).toBe(version);
            expect(record?.title).toBe('Keyed');
            expect(record?.moves).toEqual(['h2e2', 'h9g7', 'h0g2']);
            expect(record?.moveTree[0]?.comment).toBe('Central cannon.');
            expect(record?.moveTree[0]?.children?.[1]?.comment).toBe('The same-direction cannon.');
            expect(record?.refused).toBe(0);
            expect(record?.mainLineComplete).toBe(true);
        });
    }
});

describe('positions', () => {
    it('reads a set-up position, with 0xFF for a piece off the board, and Black to move off the first move', () => {
        const slots = Array(32).fill(0xff);
        slots[4] = 40;   // red general e0
        slots[0] = 80;   // red chariot i0
        slots[20] = 39;  // black general d9, off Red's file
        slots[16] = 9;   // black chariot a9
        const record = parseXqf(writeXqf({ version: 12, slots, tree: [{ uci: 'a9a8' }], keyBytes: [0xff, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8] }));
        expect(record?.startFen).toBe('r2k5/9/9/9/9/9/9/9/9/4K3R b - - 0 1');
        expect(record?.moves).toEqual(['a9a8']);
    });

    it('refuses a header without both generals', () => {
        const slots = Array(32).fill(0xff);
        slots[4] = 40;
        expect(parseXqf(writeXqf({ version: 10, slots, tree: [] }))).toBeNull();
    });

    it('refuses a piece placed off the right-hand edge of the board', () => {
        // A slot byte is `file * 10 + rank`, so anything from 90 up names a
        // file that does not exist. Found by mutation: the guard reads
        // `x > 8 || y > 9`, and `y` is `value % 10` so the second half can
        // never fire -- the first half is the whole check, and nothing
        // exercised it. Without it the reader writes past the end of a rank.
        const slots = [...START_SLOTS];
        slots[0] = 90;
        expect(parseXqf(writeXqf({ version: 10, slots, tree: [] }))).toBeNull();
        // The control: the same header with that slot on the board is read.
        const onBoard = [...START_SLOTS];
        onBoard[0] = 85;
        expect(parseXqf(writeXqf({ version: 10, slots: onBoard, tree: [] }))).not.toBeNull();
    });

    it('stops a branch at a move the rules refuse and counts it', () => {
        const record = parseXqf(writeXqf({ version: 10, tree: [{ uci: 'h2e2', children: [{ uci: 'a9a0', children: [{ uci: 'h0g2' }] }] }] }));
        expect(record?.moves).toEqual(['h2e2']);
        expect(record?.refused).toBe(1);
        expect(record?.mainLineComplete).toBe(false);
    });
});

describe('whether a recovered line still owns the declared result', () => {
    for (const version of [10, 11, 12, 18]) {
        it(`distinguishes main-line and variation damage in version ${version}`, () => {
            const sideDamage = writeXqf({ version, result: 3, tree: [{ uci: 'h2e2', children: [
                { uci: 'h9g7' }, { uci: 'a9a0' },
            ] }] });
            expect(parseXqf(sideDamage)).toMatchObject({ mainLineComplete: true, refused: 1, moves: ['h2e2', 'h9g7'] });
            const replacedMain = writeXqf({ version, result: 3, tree: [{ uci: 'a0a9' }, { uci: 'h2e2' }] });
            expect(parseXqf(replacedMain)).toMatchObject({ mainLineComplete: false, refused: 1, moves: ['h2e2'] });
            const complete = writeXqf({ version, result: 3, tree: [{ uci: 'h2e2', children: [{ uci: 'h9g7', comment: 'End.' }] }] });
            // Even an intact move with missing comment bytes is not a complete record.
            expect(parseXqf(complete.subarray(0, complete.length - 1))?.mainLineComplete).toBe(false);
            // The parent's continuation flag promises a child whose bytes are missing.
            const leafBytes = 12; // 4 move + 4 length + 4 comment bytes
            expect(parseXqf(complete.subarray(0, complete.length - leafBytes)))
                .toMatchObject({ mainLineComplete: false, moves: ['h2e2'] });
            const rootOnly = writeXqf({ version, result: 3, tree: [] });
            expect(parseXqf(rootOnly)?.mainLineComplete).toBe(true);
            expect(parseXqf(rootOnly.subarray(0, 1024))?.mainLineComplete).toBe(false);
            expect(parseXqf(rootOnly.subarray(0, rootOnly.length - 1))?.mainLineComplete).toBe(false);
        });
    }
});

/** Build a deep file without making the fixture writer recursive too. */
function deepXqf(count: number, refused = false): Uint8Array {
    const root = writeXqf({ version: 10, tree: [] });
    const file = new Uint8Array(root.length + count * 8 + (refused ? 8 : 0));
    file.set(root);
    file[1026] = 0xf0;
    const cycle = ['h0g2', 'h9g7', 'g2h0', 'g7h9'];
    for (let i = 0; i < count; i += 1) {
        const move = refused ? 'a0a9' : cycle[i % 4];
        const offset = root.length + i * 8;
        file[offset] = byteOf(move.slice(0, 2)) + 24;
        file[offset + 1] = byteOf(move.slice(2)) + 32;
        file[offset + 2] = (i < count - 1 ? 0xf0 : 0) | (refused && i === 0 ? 1 : 0);
    }
    if (refused) {
        file[root.length + count * 8] = byteOf('h2') + 24;
        file[root.length + count * 8 + 1] = byteOf('e2') + 32;
    }
    return file;
}

describe('deep XQF studies', () => {
    it('reads a long main line without consuming the call stack', () => {
        const record = parseXqf(deepXqf(8192));
        expect(record?.moves.length).toBe(8192);
        expect(record?.mainLineComplete).toBe(true);
    });

    it('skips descendants of a refused move and resumes its legal sibling', () => {
        const validate = vi.spyOn(rules, 'validatePieceMove');
        try {
            const record = parseXqf(deepXqf(8192, true));
            expect(record).toMatchObject({ moves: ['h2e2'], refused: 1, mainLineComplete: false });
            expect(record?.moveTree).toEqual([{ uci: 'h2e2' }]);
            expect(validate).toHaveBeenCalledTimes(2);
        } finally { validate.mockRestore(); }
    });

    it('rejects an oversized file before validating moves or constructing its tree', () => {
        const validate = vi.spyOn(rules, 'validatePieceMove');
        try {
            expect(() => parseXqf(deepXqf(8192), 1024)).toThrow(XqfMoveLimitError);
            expect(validate).not.toHaveBeenCalled();
        } finally { validate.mockRestore(); }
        expect(parseXqf(deepXqf(1024), 1024)?.moves.length).toBe(1024);
    });

    for (const version of [10, 11, 12, 18]) {
        it(`counts all branches, not comments or the root, in version ${version}`, () => {
            const file = writeXqf({ version, rootComment: 'h2e2 '.repeat(100), tree: [
                { uci: 'h2e2', children: [{ uci: 'h9g7' }] },
                { uci: 'a0a9', children: [{ uci: 'h9g7' }] },
            ] });
            expect(() => parseXqf(file, 3)).toThrow(XqfMoveLimitError);
            expect(parseXqf(file, 4)).toMatchObject({ moves: ['h2e2', 'h9g7'], refused: 1 });
            expect(parseXqf(writeXqf({ version, rootComment: 'Diagram', tree: [] }), 0)?.rootComment).toBe('Diagram');
        });
    }
});
