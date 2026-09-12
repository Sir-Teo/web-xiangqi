import { describe, expect, it } from 'vitest';
import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';
import { removeSubtree } from './moveTreeEdit';
import { restoreRemovedSubtree } from './restoreRemovedSubtree';

function node(id: string, parentId: string | null, childrenIds: string[] = [], uci = id): MoveTreeNode {
    const record: MoveRecord = { uci, piece: 'R', captured: '', board: [], sideToMove: 'b', inCheck: false, ply: 1, comment: `Note ${id}` };
    return { id, parentId, childrenIds, ...(parentId ? { record } : { comment: 'Root note' }) };
}
function fixture(): Record<string, MoveTreeNode> {
    return { root: node('root', null, ['a']), a: node('a', 'root', ['b', 'd']),
        b: node('b', 'a', ['c']), c: node('c', 'b'), d: node('d', 'a') };
}

describe('restore a deleted branch into the current study', () => {
    it('keeps later root/move notes and new branches while restoring the removed line', () => {
        const before = fixture();
        const { tree: current } = removeSubtree(before, 'root', 'b');
        current.root = { ...current.root, comment: 'Updated root' };
        current.a = { ...current.a, record: { ...current.a.record!, comment: undefined }, childrenIds: ['d', 'new'] };
        current.new = node('new', 'a');
        const restored = restoreRemovedSubtree(current, before, 'b')!;
        expect(restored.tree.a.record?.comment).toBeUndefined();
        expect(restored.tree.root).toBe(current.root);
        expect(restored.tree.new).toBe(current.new);
        expect(restored.tree.d).toBe(current.d);
        expect(restored.tree.a.childrenIds).toEqual(['b', 'd', 'new']);
        expect(restored.tree.b.record?.comment).toBe('Note b');
        expect(restored.tree.c.record?.comment).toBe('Note c');
        expect(restored.restoredIds.get('c')).toBe('c');
        expect(before.a.childrenIds).toEqual(['b', 'd']);
        expect(current.a.childrenIds).toEqual(['d', 'new']);
    });
    it('restores between surviving siblings and before subsequently appended branches', () => {
        const before = fixture();
        before.a.childrenIds = ['d', 'b'];
        const { tree: current } = removeSubtree(before, 'root', 'b');
        current.new = node('new', 'a');
        current.a = { ...current.a, childrenIds: ['d', 'new'] };
        expect(restoreRemovedSubtree(current, before, 'b')!.tree.a.childrenIds).toEqual(['d', 'b', 'new']);
    });
    it('reuses a re-created move and merges old descendants without duplicate sibling moves', () => {
        const before = fixture();
        const { tree: current } = removeSubtree(before, 'root', 'b');
        current.replayed = node('replayed', 'a', ['new'], 'b');
        current.new = node('new', 'replayed');
        current.a = { ...current.a, childrenIds: ['d', 'replayed'] };
        const restored = restoreRemovedSubtree(current, before, 'b')!;
        expect(restored.tree.b).toBeUndefined();
        expect(restored.tree.replayed.record?.comment).toBe('Note replayed');
        expect(restored.tree.replayed.childrenIds).toEqual(['c', 'new']);
        expect(restored.tree.c.parentId).toBe('replayed');
        expect(restored.restoredIds.get('b')).toBe('replayed');
        expect(restored.tree.a.childrenIds).toEqual(['d', 'replayed']);
    });
    it('keeps a new score with its own depth/kind rather than inheriting the old reading', () => {
        const before = fixture();
        before.b.record = { ...before.b.record!, evalScore: 20000, evalScoreKind: 'cp', evalDepth: 40, persistEvaluation: true };
        const { tree: current } = removeSubtree(before, 'root', 'b');
        current.replayed = node('replayed', 'a', [], 'b');
        current.replayed.record = { ...current.replayed.record!, evalScore: 25 };
        current.a = { ...current.a, childrenIds: ['d', 'replayed'] };
        const record = restoreRemovedSubtree(current, before, 'b')!.tree.replayed.record!;
        expect(record.evalScore).toBe(25);
        expect(record.evalDepth).toBeUndefined();
        expect(record.evalScoreKind).toBeUndefined();
        expect(record.persistEvaluation).toBe(true);
    });
    it('restores missing annotations on a replayed move and respects explicitly replaced or cleared annotations', () => {
        const before = fixture();
        before.b.record = { ...before.b.record!, evalScore: 20000, evalScoreKind: 'cp', evalDepth: 40, quality: 'good', persistEvaluation: true, nags: [1, 42] };
        const { tree: current } = removeSubtree(before, 'root', 'b');
        current.replayed = node('replayed', 'a', [], 'b');
        delete current.replayed.record!.comment;
        current.a = { ...current.a, childrenIds: ['d', 'replayed'] };
        let record = restoreRemovedSubtree(current, before, 'b')!.tree.replayed.record!;
        expect(record.comment).toBe('Note b');
        expect(record.evalScoreKind).toBe('cp');
        expect(record.evalDepth).toBe(40);
        expect(record.quality).toBe('good');
        expect(record.nags).toEqual([1, 42]);
        current.replayed.record!.nags = [2];
        expect(restoreRemovedSubtree(current, before, 'b')!.tree.replayed.record!.nags).toEqual([2]);
        current.replayed.record!.comment = undefined;
        current.replayed.record!.nags = undefined;
        record = restoreRemovedSubtree(current, before, 'b')!.tree.replayed.record!;
        expect(record.comment).toBeUndefined();
        expect(record.nags).toBeUndefined();
    });
    it('rejects missing parents, unrelated ID collisions and broken or cyclic snapshots atomically', () => {
        const before = fixture();
        const { tree: current } = removeSubtree(before, 'root', 'b');
        expect(restoreRemovedSubtree(current, before, 'root')).toBeNull();
        expect(restoreRemovedSubtree(current, before, 'missing')).toBeNull();
        expect(restoreRemovedSubtree({}, before, 'b')).toBeNull();
        expect(restoreRemovedSubtree({ ...current, c: node('c', 'd') }, before, 'b')).toBeNull();
        before.c.childrenIds = ['b'];
        expect(restoreRemovedSubtree(current, before, 'b')).toBeNull();
        expect(Object.keys(current).sort()).toEqual(['a', 'd', 'root']);
    });
    it('preserves a main line explicitly chosen after deletion', () => {
        const before = fixture();
        const { tree: current } = removeSubtree(before, 'root', 'b');
        const restored = restoreRemovedSubtree(current, before, 'b', true)!;
        expect(restored.tree.a.childrenIds).toEqual(['d', 'b']);
        expect(restored.tree.b.record?.comment).toBe('Note b');
        expect(restoreRemovedSubtree(current, before, 'b')!.tree.a.childrenIds).toEqual(['b', 'd']);
    });
    it('restores a long line without recursion', () => {
        const before: Record<string, MoveTreeNode> = { root: node('root', null, ['n0']) };
        for (let i = 0; i < 10000; i++) before[`n${i}`] = node(`n${i}`, i ? `n${i - 1}` : 'root', i < 9999 ? [`n${i + 1}`] : []);
        const restored = restoreRemovedSubtree({ root: node('root', null) }, before, 'n0')!;
        expect(Object.keys(restored.tree)).toHaveLength(10001);
        expect(restored.restoredIds.size).toBe(10000);
    });
});
