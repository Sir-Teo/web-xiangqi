import { describe, expect, it } from 'vitest';
import { exportPgnFromMoveTree } from './gameExport';
import { normalizeSavedGame } from './gameLibrary';
import { parsePgnCollection } from './pgnCollection';
import { extractPgnHeaders } from './gameMetadata';
import { planMoveLineImport } from './moveLineImportPlan';
import { buildShareUrl } from './shareUrl';
import { START_POSITION_FEN } from './xiangqi';
import { readAutoSavedGame, writeAutoSavedGame } from './autoSave';

const tree = [
    { uci: 'b2e2', comment: 'Chosen line', children: [{ uci: 'b9c7' }] },
    { uci: 'h2e2', comment: 'Other line', children: [{ uci: 'h9g7' }] },
];
const game = { id: 'study', savedAt: 1, gameMode: 'PvP' as const, moves: ['h2e2'], moveTree: tree, mainLinePinned: true as const };

describe('main-line persistence', () => {
    it('keeps an explicit pin and the independent selected cursor in saved games and recovery', () => {
        const saved = normalizeSavedGame(game)!;
        expect(saved.mainLinePinned).toBe(true);
        expect(saved.moves).toEqual(['h2e2']);
        expect(saved.moveTree?.[0].uci).toBe('b2e2');
        const values = new Map<string, string>();
        const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
        expect(writeAutoSavedGame(game, storage)).toBe('saved');
        expect(readAutoSavedGame(storage)?.game.mainLinePinned).toBe(true);
        expect(normalizeSavedGame({ ...game, mainLinePinned: 'true' })?.mainLinePinned).toBeUndefined();
        expect(normalizeSavedGame({ ...game, mainLinePinned: false })?.mainLinePinned).toBeUndefined();
    });
    it('exports first-child priority instead of the viewed variation, and carries its marker through PGN imports', () => {
        const pgn = exportPgnFromMoveTree(tree, { mainLineMoves: game.moves, mainLinePinned: true })!;
        expect(pgn).toContain('[XiangqiMainLine "1"]');
        const imported = parsePgnCollection(pgn)[0];
        expect(imported.mainLinePinned).toBe(true);
        expect(imported.moves).toEqual(['b2e2', 'b9c7']);
        expect(imported.moveTree?.[1].comment).toBe('Other line');
        const plan = planMoveLineImport(pgn, '', { validateMoveSequence: () => ({ ok: true }), validateMoveTree: () => ({ ok: true }) });
        expect(plan.kind === 'line' && plan.mainLinePinned).toBe(true);
        const ordinary = parsePgnCollection(exportPgnFromMoveTree(tree, { mainLineMoves: game.moves })!)[0];
        expect(ordinary.moves).toEqual(['h2e2', 'h9g7']);
        expect(ordinary.mainLinePinned).toBeUndefined();
    });
    it('uses the pinned line outcome rather than a terminal side variation', () => {
        const startFen = '4k4/1R7/9/9/9/9/9/9/R8/3K5 w - - 0 1';
        const live = exportPgnFromMoveTree([{ uci: 'a1a2' }, { uci: 'a1a9' }], { startFen, mainLinePinned: true, mainLineMoves: ['a1a9'], result: 'red-wins' })!;
        expect(live).toContain('[Result "*"]');
        const mate = exportPgnFromMoveTree([{ uci: 'a1a9' }, { uci: 'a1a2' }], { startFen, mainLinePinned: true, mainLineMoves: ['a1a2'] })!;
        expect(mate).toContain('[Result "1-0"]');
    });
    it('accepts the PGN marker only in leading headers, not notes or later records', () => {
        expect(extractPgnHeaders('[XiangqiMainLine "1"] 1.h2e2 *').xiangqimainline).toBe('1');
        expect(extractPgnHeaders('{[XiangqiMainLine "1"]} 1.h2e2 *').xiangqimainline).toBeUndefined();
        expect(extractPgnHeaders('1.h2e2 *\n[XiangqiMainLine "1"] 1.b2e2 *').xiangqimainline).toBeUndefined();
    });
    it('shares a pin only when the complete variation tree is included', () => {
        const shared = buildShareUrl('https://example.test/', START_POSITION_FEN, game.moves, 'PvP', tree, undefined, true);
        expect(new URL(shared.url).searchParams.get('main')).toBe('1');
        expect(shared.treeOmitted).toBe(false);
        const noTree = buildShareUrl('https://example.test/', START_POSITION_FEN, game.moves, 'PvP', undefined, undefined, true);
        expect(new URL(noTree.url).searchParams.has('main')).toBe(false);
        const oversized = Array.from({ length: 100 }, () => ({ uci: 'h2e2', comment: 'x'.repeat(500) }));
        const omitted = buildShareUrl('https://example.test/', START_POSITION_FEN, game.moves, 'PvP', oversized, undefined, true);
        expect(omitted.treeOmitted).toBe(true);
        expect(new URL(omitted.url).searchParams.has('main')).toBe(false);
    });
});
