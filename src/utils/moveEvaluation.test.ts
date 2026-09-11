import { describe, expect, it } from 'vitest';
import { normalizeMoveEvaluation, replaceMoveEvaluation } from './moveEvaluation';
import { extractAnnotatedMainLine, extractUciMoveTree } from './moveImport';
import { exportPgnFromMoveTree } from './gameExport';
import { normalizeSavedGame } from './gameLibrary';
import { encodeSavedMoveTreeParam, decodeSavedMoveTreeParam } from './shareTree';
import { serializeSavedMoveTree } from './savedMoveTree';
import type { MoveTreeNode } from '../hooks/useXiangqi';

describe('durable move evaluations', () => {
    it('validates score, depth and supported quality independently', () => {
        expect(normalizeMoveEvaluation({ evalScore: 0, evalDepth: 0, quality: 'mistake', extra: 'omit' })).toEqual({ evalScore: 0, evalDepth: 0, quality: 'mistake' });
        expect(normalizeMoveEvaluation({ evalDepth: 18, quality: 'blunder' })).toEqual({ quality: 'blunder' });
        for (const evalScore of [NaN, Infinity, Number.MAX_VALUE, '42']) expect(normalizeMoveEvaluation({ evalScore, evalDepth: 18 })).toEqual({});
        for (const evalDepth of [-1, 1.5, 65536, Infinity, '18']) expect(normalizeMoveEvaluation({ evalScore: 42, evalDepth, quality: 'invented' })).toEqual({ evalScore: 42 });
    });
    it('clears an old depth even when a fresh search returns the same score', () => {
        const previous = Object.freeze({ evalScore: 42, evalDepth: 18, comment: 'Keep my note' });
        const next = replaceMoveEvaluation(previous, 42);
        expect(next).not.toBe(previous);
        expect(next.evalDepth).toBeUndefined();
        expect(next.comment).toBe(previous.comment);
        expect(previous.evalDepth).toBe(18);
        expect(replaceMoveEvaluation(next, 42)).toBe(next);
    });
    it('keeps the current depth with its score when replacing annotations', () => {
        expect(replaceMoveEvaluation({ evalScore: 42, evalDepth: 18 }, -75, 21)).toEqual({ evalScore: -75, evalDepth: 21 });
        const read = extractAnnotatedMainLine('h2e2 {[%eval 0.42,18]} {[%eval -0.75]}');
        expect(read.annotations[0]).toEqual({ evalScore: -75, evalDepth: undefined });
    });
    it('preserves evaluations and glyph qualities on nested moves through PGN, storage and sharing', () => {
        const source = 'h2e2 $6 {[%eval +0.42,18] Main} h9g7 {[%eval -0.75,21]} (b9c7 $4 {[%eval #-0,0] Branch}) *';
        const parsed = extractUciMoveTree(source);
        const saved = normalizeSavedGame({ id: 'annotated', savedAt: 1, gameMode: 'PvP', moves: parsed.moves, moveTree: parsed.moveTree })!;
        expect(saved.review).toBeUndefined();
        expect(saved.moveTree?.[0]).toMatchObject({ evalScore: 42, evalDepth: 18, quality: 'inaccuracy', comment: 'Main' });
        expect(saved.moveTree?.[0].children?.[1]).toMatchObject({ evalScore: -30000, evalDepth: 0, quality: 'blunder', comment: 'Branch' });
        expect(decodeSavedMoveTreeParam(encodeSavedMoveTreeParam(saved.moveTree!))).toEqual(saved.moveTree);
        expect(extractUciMoveTree(exportPgnFromMoveTree(saved.moveTree!)!).moveTree).toEqual(saved.moveTree);
    });
    it('serializes durable annotations while leaving ordinary live readings transient', () => {
        const position = { piece: 'C', captured: '', board: [], sideToMove: 'b' as const, inCheck: false, ply: 1 };
        const nodes = {
            root: { id: 'root', parentId: null, childrenIds: ['a', 'b'] },
            a: { id: 'a', parentId: 'root', childrenIds: [], record: { ...position, uci: 'h2e2', evalScore: 42, evalDepth: 18, quality: 'inaccuracy', persistEvaluation: true } },
            b: { id: 'b', parentId: 'root', childrenIds: [], record: { ...position, uci: 'b2e2', evalScore: 50 } },
        } as Record<string, MoveTreeNode>;
        expect(serializeSavedMoveTree(nodes, 'root')).toEqual([{ uci: 'h2e2', evalScore: 42, evalDepth: 18, quality: 'inaccuracy' }, { uci: 'b2e2' }]);
    });
});
