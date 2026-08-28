import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MoveListTree } from './MoveListTree';
import type { MoveRecord, MoveTreeNode } from '../../hooks/useXiangqi';
import { START_FEN, parseFenBoard } from '../../utils/xiangqi';

const noop = vi.fn();
const ROOT_FEN = `${START_FEN} w - - 0 1`;

function record(uci: string, piece: string, ply: number, extra: Partial<MoveRecord> = {}): MoveRecord {
    return {
        uci,
        piece,
        captured: '',
        board: parseFenBoard(START_FEN),
        sideToMove: ply % 2 === 1 ? 'b' : 'w',
        inCheck: false,
        ply,
        ...extra,
    };
}

/** Builds a straight line of moves plus optional extra children on a node. */
function lineTree(moves: Array<[string, string]>, branches: Record<string, Array<[string, string]>> = {}) {
    const treeNodes: Record<string, MoveTreeNode> = {
        root: { id: 'root', parentId: null, childrenIds: [], record: undefined },
    };
    const activeLineNodeIds: string[] = [];
    let parent = 'root';
    moves.forEach(([uci, piece], index) => {
        const id = `n${index + 1}`;
        treeNodes[parent].childrenIds.push(id);
        treeNodes[id] = { id, parentId: parent, childrenIds: [], record: record(uci, piece, index + 1) };
        activeLineNodeIds.push(id);
        parent = id;
    });
    for (const [onNode, extras] of Object.entries(branches)) {
        extras.forEach(([uci, piece], index) => {
            const id = `${onNode}-alt${index}`;
            treeNodes[onNode].childrenIds.push(id);
            const ply = (treeNodes[onNode].record?.ply ?? 0) + 1;
            treeNodes[id] = { id, parentId: onNode, childrenIds: [], record: record(uci, piece, ply) };
        });
    }
    return { treeNodes, activeLineNodeIds };
}

function render(overrides: Partial<Parameters<typeof MoveListTree>[0]> = {}) {
    const { treeNodes, activeLineNodeIds } = lineTree([['h2e2', 'C'], ['h9g7', 'n'], ['b0c2', 'N']]);
    return renderToStaticMarkup(
        <MoveListTree
            treeNodes={treeNodes}
            rootNodeId="root"
            rootFen={ROOT_FEN}
            currentNodeId="n2"
            currentMoveIndex={1}
            activeLineNodeIds={activeLineNodeIds}
            onNavigateNode={noop}
            {...overrides}
        />
    );
}

describe('MoveListTree', () => {
    it('lists the moves of the main line', () => {
        const html = render();
        expect(html).toContain('H2→E2');
        expect(html).toContain('H9→G7');
        expect(html).toContain('B0→C2');
    });

    it('tags each move with the node it navigates to', () => {
        const html = render();
        expect(html).toContain('data-node-id="n1"');
        expect(html).toContain('data-node-id="n2"');
    });

    it('describes each move in words for a screen reader', () => {
        const html = render();
        expect(html).toContain('Red cannon from H2 moves to E2');
        expect(html).toContain('Black horse from H9 moves to G7');
    });

    it('copes with an empty game', () => {
        const { treeNodes } = lineTree([]);
        const html = render({ treeNodes, activeLineNodeIds: [], currentNodeId: 'root' });
        expect(html).not.toContain('data-node-id="n1"');
    });

    it('shows a variation when the line branches', () => {
        const { treeNodes, activeLineNodeIds } = lineTree(
            [['h2e2', 'C'], ['h9g7', 'n']],
            { n1: [['b9c7', 'n']] },
        );
        const html = render({ treeNodes, activeLineNodeIds });
        expect(html).toContain('B9→C7');
    });

    it('marks a reviewed move with its quality', () => {
        const { treeNodes, activeLineNodeIds } = lineTree([['h2e2', 'C']]);
        treeNodes.n1.record = record('h2e2', 'C', 1, { quality: 'blunder', evalScore: -400, swing: 400 });
        const html = render({ treeNodes, activeLineNodeIds, currentNodeId: 'n1' });
        expect(html.toLowerCase()).toContain('blunder');
    });

    it('does not label a move that has not been reviewed', () => {
        expect(render().toLowerCase()).not.toContain('blunder');
    });
});
