import { describe, expect, it } from 'vitest';
import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';
import { appendPgnGlyph, chooseMoveGlyph, describeGlyph, normalizeMoveGlyphs, parsePgnGlyph } from './moveGlyphs';
import { extractUciMoveTree } from './moveImport';
import { normalizeSavedGame, normalizeSavedMoveTree } from './gameLibrary';
import { serializeSavedMoveTree } from './savedMoveTree';
import { encodeSavedMoveTreeParam, decodeSavedMoveTreeParam } from './shareTree';
import { annotationTokensForMove } from './pgnAnnotations';
import { exportPgnFromMoveTree } from './gameExport';
import { parsePgnCollection } from './pgnCollection';
import { replaceMoveEvaluation } from './moveEvaluation';
import { savedTreeSearchText } from './savedStudySearch';

describe('durable supplied PGN glyphs', () => {
    it('replaces a judgement group without erasing other study symbols or mutating the source', () => {
        const source = [1, 3, 14, 255];
        expect(chooseMoveGlyph(source, 2)).toEqual([14, 255, 2]);
        expect(chooseMoveGlyph(source, 17)).toEqual([1, 3, 255, 17]);
        expect(chooseMoveGlyph(source, 255)).toEqual(source);
        expect(chooseMoveGlyph(source, 0)).toEqual([1, 3, 14, 255, 0]);
        expect(chooseMoveGlyph(undefined, 7)).toEqual([7]);
        for (const invalid of [-1, 256, NaN, 1.5]) expect(chooseMoveGlyph(source, invalid)).toBe(source);
        expect(source).toEqual([1, 3, 14, 255]);
    });
    it('normalizes the complete standard code range without interpreting unknown codes', () => {
        const all = Array.from({ length: 256 }, (_, code) => code);
        expect(normalizeMoveGlyphs([...all, ...all])).toEqual(all);
        expect(normalizeMoveGlyphs([3, 3, 0, 255, -1, 256, 1.5, '1', null, NaN, Infinity])).toEqual([3, 0, 255]);
        for (const value of [null, {}, '1', [256]]) expect(normalizeMoveGlyphs(value)).toBeUndefined();
        expect(describeGlyph(255)).toBe('PGN annotation $255');
    });
    it('maps all six suffixes and accepts numeric aliases but rejects malformed codes', () => {
        expect(['!', '?', '!!', '??', '!?', '?!'].map(parsePgnGlyph)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(parsePgnGlyph('$00014')).toBe(14);
        for (const token of ['$256', '$-1', '$1.5', '$1x', '!!!', '__proto__']) expect(parsePgnGlyph(token)).toBeUndefined();
        const target = {};
        for (const token of ['!!', '$3', '$14', '$255', '$256']) appendPgnGlyph(target, token);
        expect(target).toEqual({ nags: [3, 14, 255] });
    });
    it('keeps annotations on their own main-line and nested variation moves', () => {
        const source = 'h2e2! $14 (b2e2!! a9a8!? (i9i8 $255)) h9g7?! $15 *';
        const tree = extractUciMoveTree(source).moveTree;
        expect(tree).toEqual([
            { uci: 'h2e2', nags: [1, 14], children: [{ uci: 'h9g7', nags: [6, 15], quality: 'inaccuracy' }] },
            { uci: 'b2e2', nags: [3], children: [{ uci: 'a9a8', nags: [5] }, { uci: 'i9i8', nags: [255] }] },
        ]);
        expect(normalizeSavedMoveTree(parsePgnCollection(exportPgnFromMoveTree(tree)!)[0].moveTree)).toEqual(tree);
    });
    it('retains every numeric code through normal import, collection, storage, sharing and export', () => {
        const all = Array.from({ length: 256 }, (_, code) => code);
        const tree = extractUciMoveTree(`h2e2 ${all.map(code => `$${code}`).join(' ')} *`).moveTree;
        const game = normalizeSavedGame({ id: 'glyphs', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], moveTree: tree });
        expect(game?.moveTree?.[0].nags).toEqual(all);
        expect(decodeSavedMoveTreeParam(encodeSavedMoveTreeParam(game!.moveTree!))?.[0].nags).toEqual(all);
        const exported = exportPgnFromMoveTree(game!.moveTree!)!;
        expect(extractUciMoveTree(exported).moveTree[0].nags).toEqual(all);
        expect(parsePgnCollection(exported)[0].moveTree?.[0].nags).toEqual(all);
    });
    it('retains glyphs independently of transient scores and conflicting automatic grades', () => {
        const record: MoveRecord = { uci: 'h2e2', piece: 'C', captured: '', board: [], sideToMove: 'b', inCheck: false, ply: 1,
            nags: [1, 14], evalScore: 42, quality: 'blunder' };
        const tree: Record<string, MoveTreeNode> = {
            root: { id: 'root', parentId: null, childrenIds: ['move'] },
            move: { id: 'move', parentId: 'root', childrenIds: [], record },
        };
        expect(serializeSavedMoveTree(tree, 'root')).toEqual([{ uci: 'h2e2', nags: [1, 14] }]);
        expect(replaceMoveEvaluation(record, -500).nags).toEqual([1, 14]);
        expect(annotationTokensForMove({ nags: [1, 14], quality: 'blunder' })).toEqual(['$1', '$14']);
        expect(annotationTokensForMove({ nags: [14], quality: 'mistake' })).toEqual(['$14', '$2']);
        expect(annotationTokensForMove({ nags: [2], quality: 'mistake' })).toEqual(['$2']);
        expect(savedTreeSearchText([{ uci: 'h2e2', nags: [1, 14, 255] }])).toContain('Red has a slight advantage');
    });
});
