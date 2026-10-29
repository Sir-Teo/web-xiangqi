import { describe, expect, it } from 'vitest';
import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';
import { buildMoveListNavigation, buildMoveListRows } from './moveListRows';
import { START_FEN } from './xiangqi';

function isMoveListNodeVisible(tree: Record<string, MoveTreeNode>, root: string, line: string[], id: string) {
    return buildMoveListNavigation(buildMoveListRows(tree, root, line, START_FEN), tree).rowByNode.has(id);
}

function fixture() {
    const record: MoveRecord = { uci: 'a0a1', piece: 'R', captured: '', board: [], sideToMove: 'b', inCheck: false, ply: 1 };
    const nodes: Record<string, MoveTreeNode> = {
        start: { id: 'start', parentId: null, childrenIds: ['v1', 'main'] },
        main: { id: 'main', parentId: 'start', childrenIds: [], record },
    };
    for (let i = 1; i <= 128; i += 1) {
        nodes[`v${i}`] = { id: `v${i}`, parentId: i === 1 ? 'start' : `v${i - 1}`,
            childrenIds: i === 128 ? [] : [`v${i + 1}`], record };
    }
    return nodes;
}

describe('move-list focus visibility', () => {
    it('keeps the exact visible boundary and rejects the shortened remainder', () => {
        const nodes = fixture();
        for (const id of ['main', 'v1', 'v80']) expect(isMoveListNodeVisible(nodes, 'start', ['main'], id)).toBe(true);
        for (const id of ['v81', 'v128', 'start', 'deleted']) expect(isMoveListNodeVisible(nodes, 'start', ['main'], id)).toBe(false);
    });
    it('allows the entire line once its variation is opened', () => {
        expect(isMoveListNodeVisible(fixture(), 'start', Array.from({ length: 128 }, (_, i) => `v${i + 1}`), 'v128')).toBe(true);
    });
    it('only shows the preferred continuation within a side line', () => {
        const nodes = fixture();
        nodes.hidden = { ...nodes.v3, id: 'hidden', childrenIds: [] };
        nodes.v2.childrenIds = ['hidden', 'v3'];
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'hidden')).toBe(false);
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'v3')).toBe(true);
        nodes.v2.childrenIds.reverse();
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'hidden')).toBe(true);
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'v80')).toBe(false);
    });
    it('shows forks from active moves, but not an unrendered lone continuation', () => {
        const nodes = fixture();
        nodes.start.childrenIds = ['main'];
        nodes.main.childrenIds = ['v1'];
        nodes.v1.parentId = 'main';
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'v1')).toBe(false);
        nodes.other = { ...nodes.main, id: 'other', parentId: 'main', childrenIds: [] };
        nodes.main.childrenIds.push('other');
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'v80')).toBe(true);
    });
    it('ignores missing/recordless moves and does not invent an empty line', () => {
        const nodes = fixture();
        expect(isMoveListNodeVisible(nodes, 'start', [], 'v1')).toBe(false);
        delete nodes.v1.record;
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'v1')).toBe(false);
        delete nodes.v2;
        expect(isMoveListNodeVisible(nodes, 'start', ['main'], 'v3')).toBe(false);
    });
    it('terminates cyclic side lines while keeping their actually rendered chips focusable', () => {
        const nodes = fixture();
        nodes.v3.childrenIds = ['v2'];
        const rows = buildMoveListRows(nodes, 'start', ['main'], START_FEN);
        const navigation = buildMoveListNavigation(rows, nodes);
        expect(navigation.ids).toEqual(['main', 'v1', 'v2', 'v3']);
        expect(new Set(navigation.ids).size).toBe(navigation.ids.length);
    });
});
