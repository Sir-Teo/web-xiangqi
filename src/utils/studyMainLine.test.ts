import { describe, expect, it } from 'vitest';
import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';
import { getStudyMainLine, pinStudyMainLine, unpinStudyMainLine } from './studyMainLine';

function fixture(): Record<string, MoveTreeNode> {
    const record: MoveRecord = { uci: 'a0a1', piece: 'R', captured: '', board: [], sideToMove: 'b', inCheck: false, ply: 1, comment: 'Keep this note', evalScore: 42, persistEvaluation: true };
    const node = (id: string, parentId: string | null, childrenIds: string[] = []): MoveTreeNode => ({ id, parentId, childrenIds, ...(parentId ? { record } : { comment: 'Root plan' }) });
    return { root: node('root', null, ['a', 'b', 'c']), a: node('a', 'root'), b: node('b', 'root', ['d', 'e']), c: node('c', 'root'), d: node('d', 'b'), e: node('e', 'b') };
}

describe('explicit study main line', () => {
    it('promotes the full selected path and preserves sibling order and annotations', () => {
        const tree = fixture();
        expect(getStudyMainLine(tree, 'root')).toEqual(['a']);
        const next = pinStudyMainLine(tree, 'root', ['b', 'e']);
        expect(getStudyMainLine(next, 'root')).toEqual(['b', 'e']);
        expect(next.root.childrenIds).toEqual(['b', 'a', 'c']);
        expect(next.b.childrenIds).toEqual(['e', 'd']);
        expect(next.root.comment).toBe('Root plan');
        expect(next.b.record).toBe(tree.b.record);
        expect(next.e).toBe(tree.e);
        expect(next.root.mainLinePinned).toBe(true);
        expect(next.root.mainLineRevision).toBe(1);
        expect(tree.root.childrenIds).toEqual(['a', 'b', 'c']);
        expect(tree.b.childrenIds).toEqual(['d', 'e']);
    });
    it('pins an existing first-child line and avoids duplicate changes', () => {
        const pinned = pinStudyMainLine(fixture(), 'root', ['a']);
        expect(pinned.root.mainLinePinned).toBe(true);
        expect(pinStudyMainLine(pinned, 'root', ['a'])).toBe(pinned);
    });
    it('clears the pin without changing moves, and tracks later explicit selections', () => {
        const first = pinStudyMainLine(fixture(), 'root', ['a']);
        const second = pinStudyMainLine(first, 'root', ['b', 'd']);
        expect(second.root.mainLineRevision).toBe(2);
        const cleared = unpinStudyMainLine(second, 'root');
        expect(cleared.root.mainLinePinned).toBeUndefined();
        expect(cleared.root.mainLineRevision).toBe(3);
        expect(cleared.root.childrenIds).toBe(second.root.childrenIds);
        expect(cleared.b).toBe(second.b);
        expect(unpinStudyMainLine(cleared, 'root')).toBe(cleared);
    });
    it('refuses disconnected, partial, empty or cyclic paths atomically', () => {
        const tree = fixture();
        for (const line of [[], ['missing'], ['d'], ['b'], ['b', 'a'], ['b', 'b']]) expect(pinStudyMainLine(tree, 'root', line)).toBe(tree);
        expect(pinStudyMainLine(tree, 'missing', ['a'])).toBe(tree);
        tree.a.childrenIds = ['root'];
        expect(getStudyMainLine(tree, 'root')).toEqual(['a']);
        expect(pinStudyMainLine(tree, 'root', ['a', 'root'])).toBe(tree);
    });
});
