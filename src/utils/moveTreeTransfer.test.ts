import { describe, expect, it } from 'vitest';
import type { SavedMoveTreeNode } from './gameLibrary';
import { flattenMoveTree, inflateMoveTree, packCollectionGames, unpackCollectionGames } from './moveTreeTransfer';

describe('move tree transfer', () => {
    it('round-trips variations, their order, and node fields', () => {
        const tree: SavedMoveTreeNode[] = [
            {
                uci: 'h2e2',
                comment: 'central cannon',
                children: [
                    { uci: 'h9g7', children: [{ uci: 'h0g2' }] },
                    { uci: 'b9c7', nags: [1] },
                ],
            },
            { uci: 'c3c4' },
        ];
        expect(inflateMoveTree(flattenMoveTree(tree))).toEqual(tree);
    });

    it('leaves an empty tree empty', () => {
        expect(flattenMoveTree([])).toEqual([]);
        expect(inflateMoveTree([])).toEqual([]);
    });

    it.each([0, 1, -2, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid first parent %s instead of creating an unreachable or cyclic tree', parent => {
        expect(() => inflateMoveTree([{ uci: 'h2e2', parent }])).toThrow('Invalid move tree transfer');
    });

    it('rejects a self-reference or forward link later in the tree', () => {
        for (const parent of [1, 2]) {
            expect(() => inflateMoveTree([{ uci: 'h2e2', parent: -1 }, { uci: 'h9g7', parent }])).toThrow('Invalid move tree transfer');
        }
    });

    it('carries a line far deeper than structured clone can nest', () => {
        const root: SavedMoveTreeNode = { uci: 'a0a1' };
        let tip = root;
        for (let ply = 1; ply < 20_000; ply++) {
            const next: SavedMoveTreeNode = { uci: ply % 2 ? 'a9a8' : 'a0a1' };
            tip.children = [next];
            tip = next;
        }
        const flat = flattenMoveTree([root]);
        expect(flat).toHaveLength(20_000);
        // The flat form is what crosses the worker boundary.
        const rebuilt = inflateMoveTree(structuredClone(flat));
        let depth = 0;
        for (let node: SavedMoveTreeNode | undefined = rebuilt[0]; node; node = node.children?.[0]) depth++;
        expect(depth).toBe(20_000);
    });
});

describe('collection packing', () => {
    it('flattens only the move tree and restores it', () => {
        const games = [
            { gameMode: 'PvP' as const, moves: ['h2e2'], moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }] },
            { gameMode: 'PvP' as const, moves: [] },
        ];
        const packed = packCollectionGames(games);
        expect(packed[0]).not.toHaveProperty('moveTree');
        expect(packed[1]).toEqual(games[1]);
        expect(unpackCollectionGames(structuredClone(packed))).toEqual(games);
    });
});
