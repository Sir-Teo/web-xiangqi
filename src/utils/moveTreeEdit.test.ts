import { describe, expect, it } from 'vitest';
import type { MoveTreeNode } from '../hooks/useXiangqi';
import { collectSubtreeIds, removeSubtree } from './moveTreeEdit';

function node(id: string, parentId: string | null, childrenIds: string[] = []): MoveTreeNode {
    return { id, parentId, childrenIds };
}

// root -> a -> b -> c
//           \-> d -> e
function tree(): Record<string, MoveTreeNode> {
    return {
        root: node('root', null, ['a']),
        a: node('a', 'root', ['b', 'd']),
        b: node('b', 'a', ['c']),
        c: node('c', 'b'),
        d: node('d', 'a', ['e']),
        e: node('e', 'd'),
    };
}

describe('collectSubtreeIds', () => {
    it('gathers the node and everything under it', () => {
        expect(collectSubtreeIds(tree(), 'a').sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(collectSubtreeIds(tree(), 'd').sort()).toEqual(['d', 'e']);
        expect(collectSubtreeIds(tree(), 'missing')).toEqual([]);
    });
});

describe('removeSubtree', () => {
    it('drops a variation and unlinks it from its parent', () => {
        const before = tree();
        const { tree: after, removedIds } = removeSubtree(before, 'root', 'd');
        expect(removedIds.sort()).toEqual(['d', 'e']);
        expect(Object.keys(after).sort()).toEqual(['a', 'b', 'c', 'root']);
        expect(after.a.childrenIds).toEqual(['b']);
        // untouched nodes are the same objects; the parent is a new one
        expect(after.b).toBe(before.b);
        expect(after.a).not.toBe(before.a);
        expect(before.a.childrenIds).toEqual(['b', 'd']);
    });

    it('refuses the root and unknown ids without copying', () => {
        const before = tree();
        expect(removeSubtree(before, 'root', 'root').tree).toBe(before);
        expect(removeSubtree(before, 'root', 'nope').tree).toBe(before);
    });
});
