import { describe, expect, it } from 'vitest';
import { exportPgn, exportPgnFromMoveTree, exportPgnFromUci } from './gameExport';
import { extractFenTag, extractUciMoveLine, extractUciMoveTree } from './moveImport';
import type { SavedMoveTreeNode } from './gameLibrary';

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
