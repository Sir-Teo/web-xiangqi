import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MoveListTree } from './MoveListTree';
import { START_FEN, parseFenBoard, type BoardState } from '../../utils/xiangqi';

/**
 * The coach hint beside a move, and the review note under it.
 *
 * Both are drawn from review data stored on the node, and both are gated: the
 * hint only for a move the review criticised, and only when the engine's
 * choice actually differs from what was played; the note only for a critical
 * grade. Neither gate was tested -- no unit test named `bestMove` at all --
 * so a mutation sweep could loosen all three conditions with the suite green.
 *
 * Loosened, the move list tells the reader the engine suggested the move they
 * just played, and puts a criticism under a move the review liked.
 */
const ROOT = 'root';
const board: BoardState = parseFenBoard(START_FEN);

type Overrides = Record<string, unknown>;

function render(overrides: Overrides) {
    const tree: Record<string, unknown> = {
        [ROOT]: { id: ROOT, parentId: null, childrenIds: ['n1'], record: undefined },
        n1: {
            id: 'n1',
            parentId: ROOT,
            childrenIds: [],
            record: {
                uci: 'h2e2', piece: 'C', captured: '', board,
                sideToMove: 'b', inCheck: false, ply: 1, ...overrides,
            },
        },
    };
    return renderToStaticMarkup(
        <MoveListTree
            treeNodes={tree as never}
            moveStructure={tree as never}
            rootNodeId={ROOT}
            rootFen={START_FEN}
            currentNodeId="n1"
            activeLineNodeIds={['n1']}
            onNavigateNode={() => {}}
        />
    );
}

describe('the coach hint beside a criticised move', () => {
    it('names the engine move when it differs from the one played', () => {
        const html = render({ quality: 'blunder', bestMove: 'b2e2' });
        expect(html).toContain('mtree-coach-hint');
        expect(html).toContain('Engine suggested');
    });

    it('says nothing when the engine agrees with the move played', () => {
        // `bestMove === uci` is the engine confirming the move. Suggesting it
        // back to the reader would be nonsense.
        expect(render({ quality: 'blunder', bestMove: 'h2e2' })).not.toContain('mtree-coach-hint');
    });

    it('says nothing on a move the review did not criticise', () => {
        expect(render({ quality: 'good', bestMove: 'b2e2' })).not.toContain('mtree-coach-hint');
        expect(render({ quality: 'best', bestMove: 'b2e2' })).not.toContain('mtree-coach-hint');
    });
});

describe('the review note under a move', () => {
    it('shows it for a critical grade', () => {
        const html = render({ quality: 'mistake', bestMove: 'b2e2', reviewNote: 'Loses a chariot.' });
        expect(html).toContain('mtree-review-note');
        expect(html).toContain('Loses a chariot.');
    });

    it('withholds it from a move the review approved of', () => {
        const html = render({ quality: 'good', bestMove: 'b2e2', reviewNote: 'Loses a chariot.' });
        expect(html).not.toContain('mtree-review-note');
    });

    it('has nothing to show when the review wrote no note', () => {
        expect(render({ quality: 'blunder', bestMove: 'b2e2' })).not.toContain('mtree-review-note');
    });
});
