import { describe, expect, it } from 'vitest';
import type { MoveTreeNode } from '../hooks/useXiangqi';
import { START_FEN, parseFenBoard } from './xiangqi';
import { appendMoveTreeLine, hasMoveTreeLine } from './appendMoveTreeLine';

const board = parseFenBoard(START_FEN);
const root = (): Record<string, MoveTreeNode> => ({ root: { id: 'root', parentId: null, childrenIds: [] } });
const append = (tree: Record<string, MoveTreeNode>, parent: string, moves: string[], next = 1) =>
    appendMoveTreeLine(tree, parent, moves, board, 'w', next);

// A recursive freeze catches mutations to boards, records, and child arrays.
function freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(freeze);
    }
    return value;
}

describe('appendMoveTreeLine', () => {
    it('adds a legal line without mutating its source tree or boards', () => {
        const source = freeze(root());
        freeze(board);
        const result = append(source, 'root', ['h2e2', 'h9g7', 'e2e6']);
        expect(result.played).toBe(3);
        expect(source.root.childrenIds).toEqual([]);
        expect(result.tree.n3.record).toMatchObject({ uci: 'e2e6', piece: 'C', captured: 'p', ply: 3, sideToMove: 'b' });
        expect(result.tree.n1.record?.board[2][4]).toBe('C');
        expect(result.tree.n3.record?.board[2][4]).toBe('');
        expect(result.tree.n3.record?.board[6][4]).toBe('C');
    });

    it('reuses a shared prefix, its annotations, and unrelated branches', () => {
        const first = append(root(), 'root', ['h2e2', 'h9g7']);
        first.tree.n1.record!.comment = 'Central cannon';
        freeze(first.tree);
        const next = append(first.tree, 'root', ['h2e2', 'b9c7', 'h0g2'], first.nextNodeId);
        expect(next.tree.root).toBe(first.tree.root);
        expect(next.tree.n2).toBe(first.tree.n2);
        expect(next.tree.n1.record).toBe(first.tree.n1.record);
        expect(next.tree.n1.childrenIds).toEqual(['n2', 'n3']);
        expect(next.tree.n4.record?.ply).toBe(3);
        expect(first.tree.n1.childrenIds).toEqual(['n2']);
        const duplicate = append(next.tree, 'root', ['h2e2', 'b9c7', 'h0g2'], next.nextNodeId);
        expect(duplicate.tree).toBe(next.tree);
        expect(duplicate.nextNodeId).toBe(next.nextNodeId);
    });

    it('starts from the selected node rather than from the root', () => {
        const first = append(root(), 'root', ['h2e2']);
        const next = append(first.tree, 'n1', ['h9g7'], first.nextNodeId);
        expect(next.tree.n2.parentId).toBe('n1');
        expect(next.tree.n2.record).toMatchObject({ piece: 'n', ply: 2, sideToMove: 'w' });
    });

    it('stops at an invalid move and does not interpret later moves on the wrong board', () => {
        const source = root();
        const result = append(source, 'root', ['h2e2', 'h9h8', 'h0g2']);
        expect(result.played).toBe(1);
        expect(Object.keys(result.tree)).toHaveLength(2);
        expect(append(source, 'root', ['h2e2junk']).tree).toBe(source);
        expect(append(source, 'missing', ['h2e2']).played).toBe(0);
        expect(append(source, 'root', []).tree).toBe(source);
    });

    it('does not overwrite a node when an id is already occupied', () => {
        const first = append(root(), 'root', ['h2e2']);
        const next = append(first.tree, 'root', ['b2e2']);
        expect(next.tree.n1).toBe(first.tree.n1);
        expect(next.tree.n2.record?.uci).toBe('b2e2');
    });

    it('recognizes whole stored lines, not partial matches', () => {
        const { tree } = append(root(), 'root', ['h2e2', 'h9g7']);
        expect(hasMoveTreeLine(tree, 'root', ['h2e2', 'h9g7'])).toBe(true);
        expect(hasMoveTreeLine(tree, 'n1', ['h9g7'])).toBe(true);
        expect(hasMoveTreeLine(tree, 'root', ['h2e2', 'b9c7'])).toBe(false);
        expect(hasMoveTreeLine(tree, 'root', ['h2e2', 'h9g7', 'h0g2'])).toBe(false);
        expect(hasMoveTreeLine(tree, 'root', [])).toBe(false);
    });
});
