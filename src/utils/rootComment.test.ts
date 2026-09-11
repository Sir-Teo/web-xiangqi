import { describe, expect, it } from 'vitest';
import { extractUciMoveTree } from './moveImport';
import { planMoveLineImport } from './moveLineImportPlan';
import { exportPgn, exportPgnFromMoveTree, exportPgnFromUci, exportPgnTree } from './gameExport';
import { normalizeSavedGame } from './gameLibrary';
import { parsePgnCollection } from './pgnCollection';
import { buildShareUrl } from './shareUrl';
import { readAutoSavedGame, writeAutoSavedGame } from './autoSave';
import { START_POSITION_FEN } from './xiangqi';
import { DHTMLXQ_START_BINIT } from './dhtmlxq';

const rootComment = 'Opening plan 开局: develop both horses.';
const validators = { validateMoveSequence: () => ({ ok: true }), validateMoveTree: () => ({ ok: true }) };

describe('starting-position notes', () => {
    it('keeps leading comments apart from move and variation comments', () => {
        const parsed = extractUciMoveTree(`{${rootComment}} ;Second paragraph\n1.h2e2 {First move} ( {Branch preamble} b2e2 {Other cannon}) h9g7 *`);
        expect(parsed.rootComment).toBe(`${rootComment} Second paragraph`);
        expect(parsed.moveTree[0].comment).toBe('First move');
        expect(parsed.moveTree[1].comment).toBe('Other cannon');
        expect(parsed.moveTree[0].children?.[0].comment).toBeUndefined();
    });
    it('does not assign root evaluation commands to the first move', () => {
        const parsed = extractUciMoveTree('{[%eval 3.20,20] [%clk 0:10:00]} h2e2 *');
        expect(parsed.rootComment).toBeUndefined();
        expect(parsed.moveTree[0].evalScore).toBeUndefined();
    });
    it('preserves root prose across each PGN export path', () => {
        const options = { rootComment };
        const moveTree = [{ uci: 'h2e2', comment: 'Central cannon' }, { uci: 'b2e2', comment: 'Other side' }];
        const pgNs = [exportPgn([], options), exportPgnFromUci(['h2e2'], options),
            exportPgnFromMoveTree(moveTree, options)!,
            exportPgnTree({ root: { id: 'root', parentId: null, childrenIds: ['n1'], comment: rootComment },
                n1: { id: 'n1', parentId: 'root', childrenIds: [], record: { uci: 'h2e2' } as never } }, 'root')!];
        for (const pgn of pgNs) {
            expect(extractUciMoveTree(pgn).rootComment).toBe(rootComment);
            expect(pgn.indexOf(rootComment)).toBeLessThan(pgn.indexOf('h2e2') < 0 ? pgn.length : pgn.indexOf('h2e2'));
        }
        expect(extractUciMoveTree(pgNs[2]).moveTree).toEqual(moveTree);
    });
    it('imports PGN diagrams with metadata and opening notes', () => {
        const pgn = exportPgnFromUci([], { rootComment, metadata: { event: 'Opening workshop' } });
        expect(planMoveLineImport(pgn, '', validators)).toMatchObject({ kind: 'diagram', rootComment, startFen: START_POSITION_FEN });
        expect(parsePgnCollection(pgn)[0]).toMatchObject({ moves: [], rootComment, metadata: { event: 'Opening workshop' } });
    });
    it('does not turn unreadable movetext into a diagram merely because a root note or FEN exists', () => {
        expect(planMoveLineImport('{Opening note} unreadable', '', validators).kind).toBe('error');
        expect(planMoveLineImport('unreadable', START_POSITION_FEN, validators).kind).toBe('error');
    });
    it('keeps collection notes with their own games and accepts diagram-only collections', () => {
        const games = parsePgnCollection(`{${rootComment}} h2e2 {First move} * [Event "Diagram"] {A new plan} *`);
        expect(games).toHaveLength(2);
        expect(games[0]).toMatchObject({ rootComment, moves: ['h2e2'], moveTree: [{ uci: 'h2e2', comment: 'First move' }] });
        expect(games[1]).toMatchObject({ rootComment: 'A new plan', moves: [], metadata: { event: 'Diagram' } });
        expect(() => parsePgnCollection(`{${'x'.repeat(501)}} *`)).toThrow('starting-position note exceeds 500');
        expect(() => parsePgnCollection('{Plan} h2e2 ({Ambiguous} b2e2) *')).toThrow('variation note');
    });
    it('imports DhtmlXQ comment zero on games and diagrams', () => {
        const header = `[DhtmlXQ_binit]${DHTMLXQ_START_BINIT}[/DhtmlXQ_binit][DhtmlXQ_comment0]${rootComment}[/DhtmlXQ_comment0]`;
        expect(planMoveLineImport(header, '', validators)).toMatchObject({ kind: 'diagram', rootComment });
        expect(planMoveLineImport(header + '[DhtmlXQ_movelist]7747[/DhtmlXQ_movelist]', '', validators)).toMatchObject({ kind: 'line', rootComment });
    });
    it('saves and recovers a note on an otherwise untouched starting board', () => {
        const game = { gameMode: 'PvP' as const, moves: [], rootComment };
        const entries = new Map<string, string>();
        const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
        expect(writeAutoSavedGame(game, storage, 1)).toBe('saved');
        expect(readAutoSavedGame(storage)?.game).toMatchObject(game);
        expect(normalizeSavedGame({ ...game, id: 'opening', savedAt: 1 })?.rootComment).toBe(rootComment);
        expect(writeAutoSavedGame({ ...game, rootComment: '' }, storage, 2)).toBe('empty');
        expect(readAutoSavedGame(storage)).toBeNull();
        expect(normalizeSavedGame({ ...game, id: 'empty', savedAt: 1, rootComment: 12 })).toBeNull();
    });
    it('bounds root notes in storage and keeps Unicode intact in a share link', () => {
        const game = normalizeSavedGame({ id: 'one', savedAt: 1, gameMode: 'PvP', moves: [], rootComment: 'x'.repeat(1000) });
        expect(game?.rootComment).toHaveLength(500);
        const { url } = buildShareUrl('https://example.org/?old=1#hash', START_POSITION_FEN, [], 'PvP', undefined, rootComment);
        expect(new URL(url).searchParams.get('note')).toBe(rootComment);
        expect(new URL(url).searchParams.get('moves')).toBeNull();
        expect(new URL(url).searchParams.get('old')).toBeNull();
    });
});
