import { describe, expect, it } from 'vitest';
import { serializeSavedMoveTree } from './savedMoveTree';
import type { MoveTreeNode } from '../hooks/useXiangqi';

/** A tree of `id -> children`, with each node's move named after its id. */
function tree(shape: Record<string, string[]>, rootId = 'root'): Record<string, MoveTreeNode> {
    const nodes: Record<string, MoveTreeNode> = {};
    for (const [id, childrenIds] of Object.entries(shape)) {
        nodes[id] = {
            id,
            parentId: null,
            childrenIds,
            record: id === rootId ? undefined : ({ uci: id } as MoveTreeNode['record']),
        };
    }
    return nodes;
}

describe('writing a study out', () => {
    it('writes a straight line as a chain', () => {
        const nodes = tree({ root: ['a'], a: ['b'], b: ['c'], c: [] });
        expect(serializeSavedMoveTree(nodes, 'root')).toEqual([
            { uci: 'a', children: [{ uci: 'b', children: [{ uci: 'c' }] }] },
        ]);
    });

    it('leaves the children key off a move with none', () => {
        // The reader treats a missing key as an empty array, and a share link is
        // short enough already.
        expect(serializeSavedMoveTree(tree({ root: ['a'], a: [] }), 'root')).toEqual([{ uci: 'a' }]);
    });

    it('keeps every branch, in the order they were explored', () => {
        const nodes = tree({ root: ['a', 'b'], a: ['a1', 'a2'], a1: [], a2: [], b: [] });
        expect(serializeSavedMoveTree(nodes, 'root')).toEqual([
            { uci: 'a', children: [{ uci: 'a1' }, { uci: 'a2' }] },
            { uci: 'b' },
        ]);
    });

    it('writes an empty tree as nothing rather than failing', () => {
        expect(serializeSavedMoveTree(tree({ root: [] }), 'root')).toEqual([]);
        expect(serializeSavedMoveTree({}, 'root')).toEqual([]);
        expect(serializeSavedMoveTree(tree({ root: ['a'] }), 'missing')).toEqual([]);
    });

    it('skips a child that is missing or carries no move', () => {
        const nodes = tree({ root: ['a', 'ghost', 'b'], a: [], b: [] });
        delete nodes.ghost;
        nodes.root.childrenIds = ['a', 'ghost', 'b', 'blank'];
        nodes.blank = { id: 'blank', parentId: 'root', childrenIds: [] };
        expect(serializeSavedMoveTree(nodes, 'root')).toEqual([{ uci: 'a' }, { uci: 'b' }]);
    });
});

describe('the cycle guard', () => {
    it('terminates on a node that points back at itself', () => {
        // Nothing in the type stops this, and unguarded it is infinite
        // recursion during a save -- which takes the tab with it.
        //
        // The guard fires when the node is reached a *second* time, so the
        // repeat is written once and its own children are not. That is the
        // behaviour, not an off-by-one: cutting before writing would lose a
        // move that genuinely is in the tree.
        const nodes = tree({ root: ['a'], a: ['a'] });
        expect(serializeSavedMoveTree(nodes, 'root')).toEqual([
            { uci: 'a', children: [{ uci: 'a' }] },
        ]);
    });

    it('terminates on a longer loop', () => {
        const nodes = tree({ root: ['a'], a: ['b'], b: ['c'], c: ['a'] });
        expect(serializeSavedMoveTree(nodes, 'root')).toEqual([
            { uci: 'a', children: [{ uci: 'b', children: [{ uci: 'c', children: [{ uci: 'a' }] }] }] },
        ]);
    });

    it('writes a shared subtree under both branches that reach it', () => {
        // `seen` is copied per branch, not shared. A single shared set would
        // silently drop the second branch's whole subtree, which is exactly
        // what a transposition looks like.
        const nodes = tree({ root: ['a', 'b'], a: ['shared'], b: ['shared'], shared: ['end'], end: [] });
        expect(serializeSavedMoveTree(nodes, 'root')).toEqual([
            { uci: 'a', children: [{ uci: 'shared', children: [{ uci: 'end' }] }] },
            { uci: 'b', children: [{ uci: 'shared', children: [{ uci: 'end' }] }] },
        ]);
    });

    it('survives a deep chain without blowing the stack', () => {
        const shape: Record<string, string[]> = { root: ['n0'] };
        for (let i = 0; i < 900; i += 1) shape[`n${i}`] = i === 899 ? [] : [`n${i + 1}`];
        expect(() => serializeSavedMoveTree(tree(shape), 'root')).not.toThrow();
    });
});
