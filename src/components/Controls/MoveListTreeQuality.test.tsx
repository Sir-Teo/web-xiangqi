import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MoveListTree } from './MoveListTree';
import { START_FEN, parseFenBoard, type BoardState } from '../../utils/xiangqi';

/** Missing position scores cannot support a move-loss estimate. */

const ROOT = 'root';
const board: BoardState = parseFenBoard(START_FEN);

function nodes(evals: Array<number | undefined>) {
    const tree: Record<string, any> = {
        [ROOT]: { id: ROOT, parentId: null, childrenIds: ['n1'], record: undefined },
    };
    evals.forEach((evalScore, index) => {
        const id = `n${index + 1}`;
        const next = index + 2 <= evals.length ? [`n${index + 2}`] : [];
        tree[id] = {
            id,
            parentId: index === 0 ? ROOT : `n${index}`,
            childrenIds: next,
            record: {
                uci: index % 2 === 0 ? 'h2e2' : 'h9g7',
                piece: index % 2 === 0 ? 'C' : 'n',
                captured: '',
                evalScore,
                board,
                sideToMove: index % 2 === 0 ? 'b' : 'w',
                inCheck: false,
                ply: index + 1,
            },
        };
    });
    return tree;
}

const render = (evals: Array<number | undefined>) =>
    renderToStaticMarkup(
        <MoveListTree
            treeNodes={nodes(evals) as never}
            rootNodeId={ROOT}
            rootFen={START_FEN}
            currentNodeId={`n${evals.length}`}
            currentMoveIndex={evals.length - 1}
            activeLineNodeIds={evals.map((_, index) => `n${index + 1}`)}
            onNavigateNode={() => {}}
        />
    );

/** The class the tree gives a node it has no opinion about. */
const PENDING = 'quality-pending';

function classesFor(html: string, nodeId: string) {
    const match = html.match(new RegExp(`<[^>]*data-node-id="${nodeId}"[^>]*>`));
    return match ? match[0] : '';
}

describe('the colour the move tree gives a move', () => {
    it('leaves the first move ungraded until its quality is explicitly assessed', () => {
        const html = render([-260, 20]);
        expect(classesFor(html, 'n1'), 'first move').toContain(PENDING);
        expect(classesFor(html, 'n2'), 'second move').not.toContain(PENDING);
    });

    it('names a derived estimate in both the tooltip and accessible label', () => {
        const chip = classesFor(render([-500, 0]), 'n2');
        expect(chip).toContain('quality-blunder');
        expect(chip.match(/Estimated move quality Blunder/g)).toHaveLength(2);
    });

    it('still says nothing about a move it has no evaluation for', () => {
        expect(classesFor(render([undefined]), 'n1')).toContain(PENDING);
    });
});
