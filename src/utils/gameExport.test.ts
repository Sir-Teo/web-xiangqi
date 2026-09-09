import { describe, expect, it } from 'vitest';
import { exportPgn, exportPgnFromMoveTree, exportPgnFromUci, formatPgnDate } from './gameExport';
import { extractFenTag, extractUciMoveLine, extractUciMoveTree, stripRecordMetadata } from './moveImport';
import type { SavedMoveTreeNode } from './gameLibrary';
import type { MoveRecord } from '../hooks/useXiangqi';

const OPTIONS = { date: '2026.08.28' };

function tag(pgn: string, name: string): string | null {
    const match = pgn.match(new RegExp(`\\[${name} "([^"]*)"\\]`));
    return match ? match[1] : null;
}

function movetext(pgn: string): string {
    return pgn.split('\n\n').slice(1).join('\n\n').trim();
}

describe('exporting a line', () => {
    it('numbers moves in pairs from the starting position', () => {
        const pgn = exportPgnFromUci(['h2e2', 'h9g7', 'b0c2'], OPTIONS);
        expect(movetext(pgn)).toBe('1. h2e2 h9g7 2. b0c2 *');
    });

    it('marks the variant and carries the tags it was given', () => {
        const pgn = exportPgnFromUci(['h2e2'], {
            ...OPTIONS,
            gameMode: 'PvP',
            opening: 'Central Cannon',
            label: 'A study',
            result: 'red-wins',
        });
        expect(tag(pgn, 'Variant')).toBe('Xiangqi');
        expect(tag(pgn, 'Date')).toBe('2026.08.28');
        expect(tag(pgn, 'Event')).toBe('PvP');
        expect(tag(pgn, 'Opening')).toBe('Central Cannon');
        expect(tag(pgn, 'White')).toBe('A study');
        expect(tag(pgn, 'Result')).toBe('1-0');
    });

    it('writes each result the right way round', () => {
        expect(tag(exportPgnFromUci(['h2e2'], { ...OPTIONS, result: 'red-wins' }), 'Result')).toBe('1-0');
        expect(tag(exportPgnFromUci(['h2e2'], { ...OPTIONS, result: 'black-wins' }), 'Result')).toBe('0-1');
        expect(tag(exportPgnFromUci(['h2e2'], { ...OPTIONS, result: 'draw' }), 'Result')).toBe('1/2-1/2');
        expect(tag(exportPgnFromUci(['h2e2'], OPTIONS), 'Result')).toBe('*');
    });

    it('only writes a start position when it is not the usual one', () => {
        const standard = exportPgnFromUci(['h2e2'], OPTIONS);
        expect(tag(standard, 'FEN')).toBeNull();
        expect(tag(standard, 'SetUp')).toBeNull();

        const custom = exportPgnFromUci(['e0e1'], {
            ...OPTIONS,
            startFen: '3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
        });
        expect(tag(custom, 'SetUp')).toBe('1');
        expect(tag(custom, 'FEN')).toContain('3k5');
    });

    it('starts the numbering from a position where Black moves first', () => {
        const pgn = exportPgnFromUci(['h9g7', 'b0c2'], {
            ...OPTIONS,
            startFen: '3k5/9/9/9/9/9/9/9/9/4K4 b - - 0 7',
        });
        expect(movetext(pgn)).toBe('7... h9g7 8. b0c2 *');
    });

    it('exports an empty game without inventing moves', () => {
        expect(movetext(exportPgnFromUci([], OPTIONS))).toBe('*');
    });
});

describe('exporting a tree', () => {
    const tree: SavedMoveTreeNode[] = [
        {
            uci: 'h2e2',
            children: [
                { uci: 'h9g7', children: [{ uci: 'b0c2' }] },
                { uci: 'b9c7' },
            ],
        },
    ];

    it('keeps sibling branches as variations', () => {
        const pgn = exportPgnFromMoveTree(tree, { ...OPTIONS, mainLineMoves: ['h2e2', 'h9g7', 'b0c2'] })!;
        expect(pgn).not.toBeNull();
        expect(movetext(pgn)).toContain('(');
        expect(movetext(pgn)).toContain('b9c7');
    });

    it('refuses a main line the tree does not contain', () => {
        expect(exportPgnFromMoveTree(tree, { ...OPTIONS, mainLineMoves: ['h2e2', 'a0a1'] })).toBeNull();
    });
});

describe('exported PGN reads back in', () => {
    it('round-trips a straight line', () => {
        const moves = ['h2e2', 'h9g7', 'b0c2', 'b9c7'];
        expect(extractUciMoveLine(exportPgnFromUci(moves, OPTIONS))).toEqual(moves);
    });

    it('round-trips a line from a custom position, tag and all', () => {
        const startFen = '3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
        const pgn = exportPgnFromUci(['e0e1'], { ...OPTIONS, startFen });
        expect(extractFenTag(pgn)).toBe(startFen);
        expect(extractUciMoveLine(pgn)).toEqual(['e0e1']);
    });

    it('round-trips a tree with its branches intact', () => {
        const tree: SavedMoveTreeNode[] = [
            { uci: 'h2e2', children: [{ uci: 'h9g7', children: [{ uci: 'b0c2' }] }, { uci: 'b9c7' }] },
        ];
        const pgn = exportPgnFromMoveTree(tree, { ...OPTIONS, mainLineMoves: ['h2e2', 'h9g7', 'b0c2'] })!;

        const reread = extractUciMoveTree(pgn);
        expect(reread.hasVariations).toBe(true);
        expect(reread.moves).toEqual(['h2e2', 'h9g7', 'b0c2']);
        expect(reread.moveTree[0].children?.map(child => child.uci).sort()).toEqual(['b9c7', 'h9g7']);
    });

    it('does not mistake a header or a comment for a move', () => {
        const pgn = exportPgnFromUci(['h2e2'], { ...OPTIONS, label: 'a3a4 looks like a move' });
        expect(extractUciMoveLine(pgn)).toEqual(['h2e2']);
    });
});

describe('exportPgn from move records', () => {
    it('reads the uci off each record', () => {
        const pgn = exportPgn([{ uci: 'h2e2' }, { uci: 'h9g7' }] as never, OPTIONS);
        expect(movetext(pgn)).toBe('1. h2e2 h9g7 *');
    });
});

describe('the review travels with the game', () => {
    // The export carried the moves and nothing else, so an annotated game
    // opened in another tool as a bare move list.
    const annotated = (uci: string, ply: number, extra: Partial<MoveRecord> = {}): MoveRecord => ({
        uci,
        piece: ply % 2 === 1 ? 'C' : 'c',
        captured: '',
        board: [],
        sideToMove: ply % 2 === 1 ? 'b' : 'w',
        inCheck: false,
        ply,
        ...extra,
    });

    it('writes the evaluation after each move as a PGN comment', () => {
        const pgn = exportPgn([annotated('h2e2', 1, { evalScore: 38 })], { date: '2026.08.31' });
        expect(pgn).toContain('1. h2e2 { [%eval 0.38] }');
    });

    it('marks a mistake with the glyph other tools already read', () => {
        const pgn = exportPgn([
            annotated('h2e2', 1, { evalScore: 38, quality: 'best' }),
            annotated('h9g7', 2, { evalScore: -180, quality: 'mistake', bestMove: 'h7e7' }),
        ], { date: '2026.08.31' });
        expect(pgn).toContain('h9g7 $2 { [%eval -1.80] Better was h7e7 }');
        // and leaves the good move unmarked
        expect(pgn).toContain('1. h2e2 { [%eval 0.38] }');
        expect(pgn).not.toContain('h2e2 $');
    });

    it('exports exactly what it used to when nothing has been reviewed', () => {
        const pgn = exportPgn([annotated('h2e2', 1), annotated('h9g7', 2)], { date: '2026.08.31' });
        expect(pgn).toContain('1. h2e2 h9g7');
        expect(pgn).not.toContain('{');
        expect(pgn).not.toContain('$');
    });

    it('keeps the annotation with its own half of the pair', () => {
        // A black half-move joins the entry its red half started, so a glyph
        // appended in the wrong place would drift onto the next move.
        const pgn = exportPgn([
            annotated('h2e2', 1, { quality: 'blunder', bestMove: 'b0c2' }),
            annotated('h9g7', 2, { evalScore: 20 }),
            annotated('b0c2', 3, {}),
        ], { date: '2026.08.31' });
        expect(pgn).toContain('1. h2e2 $4 { Better was b0c2 } h9g7 { [%eval 0.20] } 2. b0c2');
    });

    it('reads back as the same moves, comments and all', () => {
        const moves = [
            annotated('h2e2', 1, { evalScore: 38, quality: 'best' }),
            annotated('h9g7', 2, { evalScore: -180, quality: 'blunder', bestMove: 'b9c7' }),
            annotated('b0c2', 3, { evalScore: 210, quality: 'inaccuracy', bestMove: 'c3c4' }),
        ];
        const pgn = exportPgn(moves, { date: '2026.08.31' });
        // "Better was b9c7" holds a legal-looking move; it must not be imported
        // as one.
        expect(extractUciMoveLine(stripRecordMetadata(pgn))).toEqual(['h2e2', 'h9g7', 'b0c2']);
    });
});

describe('the date a game is stamped with', () => {
    it('is the local date, not UTC', () => {
        // The PGN spec asks for the local date of the site. `toISOString()` is
        // UTC, so anywhere west of Greenwich an evening game was stamped
        // tomorrow -- at UTC-4, everything exported after 8pm.
        const evening = new Date(2026, 7, 31, 20, 30);   // 31 Aug, 8:30pm local
        expect(formatPgnDate(evening)).toBe('2026.08.31');
    });

    it('pads a single-digit month and day', () => {
        expect(formatPgnDate(new Date(2026, 0, 5, 12, 0))).toBe('2026.01.05');
    });

    it('agrees with the local calendar whatever the offset is', () => {
        // Written so it holds in any timezone CI runs in.
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, '0');
        expect(formatPgnDate(now))
            .toBe(`${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`);
    });

    it('reaches the Date tag of a game exported without one', () => {
        const pgn = exportPgn([{
            uci: 'h2e2', piece: 'C', captured: '', board: [],
            sideToMove: 'b', inCheck: false, ply: 1,
        } as MoveRecord]);
        expect(tag(pgn, 'Date')).toBe(formatPgnDate());
    });
});


describe('saved study note export', () => {
    it('keeps notes attached to main-line and alternative moves', () => {
        const pgn = exportPgnFromMoveTree([
            { uci: 'h2e2', comment: 'Main note', children: [{ uci: 'h9g7', comment: 'Reply note' }] },
            { uci: 'b2e2', comment: 'Branch note' },
        ], { mainLineMoves: ['h2e2', 'h9g7'] });
        expect(pgn).toContain('h2e2 { Main note }');
        expect(pgn).toContain('(1. b2e2 { Branch note })');
        expect(pgn).toContain('h9g7 { Reply note }');
    });
});
