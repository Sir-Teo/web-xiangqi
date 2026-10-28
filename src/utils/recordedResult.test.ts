import { describe, expect, it } from 'vitest';
import { extractPgnResult } from './pgnResult';
import { readRecordedResultPgn, normalizeRecordedResult, recordedResultFromSavedResult } from './recordedResult';
import { planMoveLineImport } from './moveLineImportPlan';
import { parsePgnCollection } from './pgnCollection';
import { exportPgnFromMoveTree, exportPgnFromUci } from './gameExport';
import { normalizeSavedGame } from './gameLibrary';
import { buildShareUrl } from './shareUrl';
import { decodeSavedMoveTreeParam } from './shareTree';
import { readAutoSavedGame, writeAutoSavedGame } from './autoSave';
import { START_POSITION_FEN } from './xiangqi';
const validators = { validateMoveSequence: () => ({ ok: true }), validateMoveTree: () => ({ ok: true }) };

describe('durable recorded results', () => {
    it('translates legacy library outcomes without accepting unrelated result spellings', () => {
        expect(recordedResultFromSavedResult('red')).toBe('red-wins');
        expect(recordedResultFromSavedResult('black')).toBe('black-wins');
        expect(recordedResultFromSavedResult('draw')).toBe('draw');
        for (const value of ['ongoing', 'unknown', 'red-wins', '1-0', null, undefined, 1, {}]) {
            expect(recordedResultFromSavedResult(value)).toBeUndefined();
        }
    });
    it('reads first-game declarations while ignoring comments, variations and later records', () => {
        expect(extractPgnResult('[Result "1/2-1/2"]\n1.h2e2 (1.b2e2 1-0) {0-1} h9g7 1/2-1/2\n[Result "0-1"] 1.b2e2 0-1')).toMatchObject({ result: 'draw' });
        expect(extractPgnResult('1.h2e2 ; 1-0\nh9g7 *')).toMatchObject({ result: undefined });
        expect(extractPgnResult('1.h2e2 0-1')).toMatchObject({ result: 'black-wins' });
        expect(extractPgnResult('[Result "1-0"]\n1.h2e2')).toMatchObject({ result: 'red-wins' });
    });
    it('does not turn an unfinished comment into a result or combine same-line games', () => {
        expect(extractPgnResult('1.h2e2 {a note mentioning 1-0')).toMatchObject({ result: undefined });
        const plan = planMoveLineImport('1.h2e2 1-0 [Result "0-1"] 1.h9g7 0-1', '', validators);
        expect(plan).toMatchObject({ kind: 'line', moves: ['h2e2'], recordedResult: 'red-wins', hadMoreGames: true });
        expect(planMoveLineImport('1.h2e2 1-0 {A final note}', '', validators)).toMatchObject({ kind: 'line', recordedResult: 'red-wins', hadMoreGames: false, moveTree: [{ uci: 'h2e2', comment: 'A final note' }] });
    });
    it('rejects invalid or contradictory declarations', () => {
        expect(extractPgnResult('[Result "win"] 1.h2e2 *').error).toBeTruthy();
        expect(extractPgnResult('[Result "1-0"] 1.h2e2 0-1').error).toBeTruthy();
        expect(normalizeRecordedResult('1-0')).toBeUndefined();
        expect(readRecordedResultPgn('[%xqresult garbage]')).toBeUndefined();
    });
    it('carries complete coordinate/notation declarations and root-only outcomes into import plans', () => {
        for (const text of ['[Result "1/2-1/2"]\n1.h2e2 h9g7 1/2-1/2', '1. C2=5 H8+7 1/2-1/2']) {
            const plan = planMoveLineImport(text, '', validators);
            expect(plan.kind === 'line' && plan.recordedResult).toBe('draw');
        }
        expect(planMoveLineImport('[Result "1/2-1/2"]\n1/2-1/2', '', validators)).toMatchObject({ kind: 'diagram', rootResult: 'draw' });
        const partial = planMoveLineImport('1. C2=5 H8+7 2. H2+9 1-0', '', validators);
        expect(partial.kind === 'line' && partial.recordedResult).toBeUndefined();
    });
    it('round-trips results on different endpoints without transferring one to another line', () => {
        const tree = [
            { uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'draw' as const, comment: 'Agreed' }] },
            { uci: 'b2e2', recordedResult: 'black-wins' as const, comment: 'Resigned' },
        ];
        const pgn = exportPgnFromMoveTree(tree, { mainLineMoves: ['h2e2'] })!;
        expect(pgn).toContain('[Result "1/2-1/2"]');
        expect(pgn).toContain('[%xqresult 0-1]');
        const imported = parsePgnCollection(pgn)[0];
        expect(imported.moveTree?.[0].children?.[0].recordedResult).toBe('draw');
        expect(imported.moveTree?.[1].recordedResult).toBe('black-wins');
        expect(imported.moveTree?.[1].comment).toBe('Resigned');
        expect(exportPgnFromMoveTree(tree, { mainLineMoves: ['b2e2'] })).toContain('[Result "0-1"]');
        expect(exportPgnFromMoveTree([{ uci: 'b2e2' }, ...tree], { mainLinePinned: true, mainLineMoves: ['h2e2', 'h9g7'], result: 'draw' })).toContain('[Result "*"]');
    });
    it('preserves a former endpoint declaration after extending the line without ending the extension', () => {
        const pgn = exportPgnFromMoveTree([{ uci: 'h2e2', recordedResult: 'draw', children: [{ uci: 'h9g7' }] }])!;
        expect(pgn).toContain('[Result "*"]');
        expect(parsePgnCollection(pgn)[0].moveTree?.[0].recordedResult).toBe('draw');
    });
    it('does not use an earlier saved result for a continuation, including legacy and root results', () => {
        for (const recordedResult of [undefined, 'draw' as const]) {
            const tree = [{ uci: 'h2e2', recordedResult, children: [{ uci: 'h9g7' }] }];
            const before = JSON.stringify(tree);
            const pgn = exportPgnFromMoveTree(tree, { mainLineMoves: ['h2e2'], result: 'draw' })!;
            expect(pgn).toContain('[Result "*"]');
            expect(pgn.trimEnd()).toMatch(/h9g7 \*$/);
            expect(parsePgnCollection(pgn)[0].moveTree?.[0].recordedResult).toBe('draw');
            expect(parsePgnCollection(pgn)[0].moveTree?.[0].children?.[0].recordedResult).toBeUndefined();
            expect(JSON.stringify(tree)).toBe(before);
        }
        const root = exportPgnFromMoveTree([{ uci: 'h2e2' }], { mainLineMoves: [], result: 'draw' })!;
        expect(root).toContain('[Result "*"]');
        expect(parsePgnCollection(root)[0].rootResult).toBe('draw');
    });
    it('retains a result supplied for the whole primary line and lets an endpoint declaration win', () => {
        const tree = [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }];
        for (const mainLineMoves of [undefined, ['h2e2', 'h9g7']]) {
            expect(exportPgnFromMoveTree(tree, { mainLineMoves, result: 'draw' })).toContain('[Result "1/2-1/2"]');
        }
        const declared = [{ uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'black-wins' as const }] }];
        const pgn = exportPgnFromMoveTree(declared, { mainLineMoves: ['h2e2'], result: 'draw' })!;
        expect(pgn).toContain('[Result "0-1"]');
        expect(pgn).toContain('[%xqresult 1/2-1/2]');
        expect(parsePgnCollection(pgn)[0].moveTree?.[0].children?.[0].recordedResult).toBe('black-wins');
    });
    it('uses a proven terminal outcome before a contradictory declaration', () => {
        const startFen = '4k4/1R7/9/9/9/9/9/9/R8/3K5 w - - 0 1';
        expect(exportPgnFromMoveTree([{ uci: 'a1a9', recordedResult: 'draw' }], { startFen })).toContain('[Result "1-0"]');
    });
    it('keeps root-only declarations through PGN, normalized storage, recovery and sharing', () => {
        const pgn = exportPgnFromUci([], { rootResult: 'draw' });
        expect(pgn).toContain('[Result "1/2-1/2"]');
        expect(planMoveLineImport(pgn, '', validators)).toMatchObject({ kind: 'diagram', rootResult: 'draw' });
        const game = { id: 'root', savedAt: 1, gameMode: 'PvP' as const, moves: [], rootResult: 'draw' as const };
        expect(normalizeSavedGame(game)?.rootResult).toBe('draw');
        const values = new Map<string, string>();
        const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
        expect(writeAutoSavedGame(game, storage)).toBe('saved');
        expect(readAutoSavedGame(storage)?.game.rootResult).toBe('draw');
        expect(new URL(buildShareUrl('https://example.test', START_POSITION_FEN, [], 'PvP', undefined, undefined, false, 'draw').url).searchParams.get('rootResult')).toBe('draw');
    });
    it('keeps endpoint annotations in normalized and shared trees', () => {
        const moveTree = [{ uci: 'h2e2', recordedResult: 'draw' as const }];
        const game = normalizeSavedGame({ id: 'result', savedAt: 1, gameMode: 'PvP', moves: [], moveTree })!;
        expect(game.moveTree?.[0].recordedResult).toBe('draw');
        const url = new URL(buildShareUrl('https://example.test', START_POSITION_FEN, [], 'PvP', moveTree).url);
        expect(decodeSavedMoveTreeParam(url.searchParams.get('tree')!)?.[0].recordedResult).toBe('draw');
    });
});
