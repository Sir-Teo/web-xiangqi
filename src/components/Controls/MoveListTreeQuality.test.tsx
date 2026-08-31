import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MoveListTree } from './MoveListTree';
import { START_FEN, parseFenBoard, type BoardState } from '../../utils/xiangqi';

/**
 * The first move of a game is graded like every other one.
 *
 * A move's live colour comes from comparing its evaluation with its parent's.
 * The root carries no record, so a first move had no parent evaluation and
 * stayed `quality-pending` for the life of the game -- every move but the
 * first got a colour, which reads as the app having no opinion about the
 * opening move rather than as a missing baseline.
 *
 * The code meant to handle it (`node?.parentId ? ... : 0`) never fired,
 * because the root's id is a truthy string, so the lookup ran and found
 * nothing. Zero is the baseline `EvalGraph` already plots the start position
 * at, so grading against it is the two agreeing rather than a new assumption.
 *
 * Rendered rather than driven through a browser because the browser suite runs
 * without an engine, and with no engine there are no evaluations to grade.
 */

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
    it('grades the first move, not only the ones after it', () => {
        const html = render([-260, 20]);
        expect(classesFor(html, 'n1'), 'first move').not.toContain(PENDING);
        expect(classesFor(html, 'n2'), 'second move').not.toContain(PENDING);
    });

    it('grades a first move that lost ground differently from one that held it', () => {
        // Judged against an even start either way, so a move that drops 260
        // centipawns cannot come out with the same colour as one that does not.
        const bad = classesFor(render([-260]), 'n1');
        const fine = classesFor(render([10]), 'n1');
        expect(bad).not.toBe(fine);
    });

    it('still says nothing about a move it has no evaluation for', () => {
        // The baseline fills in the parent, not the move itself.
        expect(classesFor(render([undefined]), 'n1')).toContain(PENDING);
    });
});
