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

/**
 * A tree that points back at itself.
 *
 * `getStudyMainLine` walks first children in a `for (;;)` whose only exit is
 * one composite guard, and no fixture here was cyclic -- so the loop had never
 * been asked to stop for that reason at all. A hang is the worst outcome an
 * app can give a reader, and the one a missing test hides best: the suite does
 * not go red, it goes quiet.
 *
 * **Two arms of that guard each stop a cycle on their own**, and measuring
 * says so: disabling `seen.has(id)` alone still passes, because a node has one
 * `parentId` and so can only be reached validly from one parent; disabling the
 * `parentId` check alone still passes, because `seen` catches the revisit.
 * Disabling **both** is what this fails on. Neither is therefore dead code --
 * each is the other's only backstop -- but neither can be tested alone, so do
 * not read a surviving mutant on either arm as a missing test.
 *
 * `pinStudyMainLine` walks the caller's line, which can repeat a node whatever
 * the tree looks like, and must refuse rather than loop.
 */
describe('a move tree that loops back on itself', () => {
    function cyclic(): Record<string, MoveTreeNode> {
        const record: MoveRecord = { uci: 'a0a1', piece: 'R', captured: '', board: [], sideToMove: 'b', inCheck: false, ply: 1 };
        return {
            root: { id: 'root', parentId: null, childrenIds: ['x'] },
            // x -> y -> x: every node has a record and a parent that agrees,
            // so only `seen` can tell this is not a line.
            x: { id: 'x', parentId: 'root', childrenIds: ['y'], record },
            y: { id: 'y', parentId: 'x', childrenIds: ['x'], record },
        };
    }

    it('stops walking instead of looping forever', () => {
        const line = getStudyMainLine(cyclic(), 'root');
        expect(line).toEqual(['x', 'y']);
    });

    it('refuses to pin a line that revisits a node', () => {
        const tree = cyclic();
        expect(pinStudyMainLine(tree, 'root', ['x', 'y', 'x'])).toBe(tree);
    });

    it('still walks a tree that merely repeats a move', () => {
        // The control: `seen` is about node identity, not about the move. A
        // line that plays the same coordinates twice is ordinary.
        const record: MoveRecord = { uci: 'a0a1', piece: 'R', captured: '', board: [], sideToMove: 'b', inCheck: false, ply: 1 };
        const tree: Record<string, MoveTreeNode> = {
            root: { id: 'root', parentId: null, childrenIds: ['p'] },
            p: { id: 'p', parentId: 'root', childrenIds: ['q'], record },
            q: { id: 'q', parentId: 'p', childrenIds: [], record },
        };
        expect(getStudyMainLine(tree, 'root')).toEqual(['p', 'q']);
    });
});
