import { describe, expect, it } from 'vitest';
import { MOVE_TREE_ROOT_ID, getMovesToNode, type MoveTreePathNode } from './moveTreePath';

function line(...moves: string[]): Record<string, MoveTreePathNode> {
    const nodes: Record<string, MoveTreePathNode> = {};
    moves.forEach((uci, index) => {
        nodes[`n${index}`] = {
            parentId: index === 0 ? MOVE_TREE_ROOT_ID : `n${index - 1}`,
            record: { uci },
        };
    });
    return nodes;
}

describe('moves from the root to a node', () => {
    it('returns them in play order, not the order they are walked', () => {
        expect(getMovesToNode(line('h2e2', 'h9g7', 'h0g2'), 'n2')).toEqual(['h2e2', 'h9g7', 'h0g2']);
    });

    it('stops at the node asked for, not at the end of the line', () => {
        expect(getMovesToNode(line('h2e2', 'h9g7', 'h0g2'), 'n1')).toEqual(['h2e2', 'h9g7']);
    });

    it('is empty at the root', () => {
        expect(getMovesToNode(line('h2e2'), MOVE_TREE_ROOT_ID)).toEqual([]);
    });

    it('is empty for a node that is not there', () => {
        expect(getMovesToNode(line('h2e2'), 'missing')).toEqual([]);
    });

    it('follows a branch rather than the main line', () => {
        const nodes: Record<string, MoveTreePathNode> = {
            a: { parentId: MOVE_TREE_ROOT_ID, record: { uci: 'h2e2' } },
            b: { parentId: 'a', record: { uci: 'h9g7' } },
            branch: { parentId: 'a', record: { uci: 'b9c7' } },
        };
        expect(getMovesToNode(nodes, 'branch')).toEqual(['h2e2', 'b9c7']);
        expect(getMovesToNode(nodes, 'b')).toEqual(['h2e2', 'h9g7']);
    });

    it('stops at a node with no move rather than inventing one', () => {
        const nodes: Record<string, MoveTreePathNode> = {
            a: { parentId: MOVE_TREE_ROOT_ID, record: { uci: 'h2e2' } },
            gap: { parentId: 'a', record: null },
            c: { parentId: 'gap', record: { uci: 'h0g2' } },
        };
        expect(getMovesToNode(nodes, 'c')).toEqual(['h0g2']);
    });

    it('does not hang on a tree that points at itself', () => {
        const nodes: Record<string, MoveTreePathNode> = {
            a: { parentId: 'b', record: { uci: 'h2e2' } },
            b: { parentId: 'a', record: { uci: 'h9g7' } },
        };
        const started = performance.now();
        expect(getMovesToNode(nodes, 'a')).toEqual(['h9g7', 'h2e2']);
        expect(performance.now() - started).toBeLessThan(50);
    });

    it('honours a root id that is not the default', () => {
        const nodes: Record<string, MoveTreePathNode> = {
            start: { parentId: null, record: { uci: 'ignored' } },
            a: { parentId: 'start', record: { uci: 'h2e2' } },
        };
        expect(getMovesToNode(nodes, 'a', 'start')).toEqual(['h2e2']);
    });
});
