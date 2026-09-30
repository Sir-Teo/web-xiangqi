import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EvalGraph } from './EvalGraph';
import { START_FEN, parseFenBoard, type BoardState } from '../../utils/xiangqi';
import type { MoveRecord } from '../../hooks/useXiangqi';

const board: BoardState = parseFenBoard(START_FEN);

function move(uci: string, ply: number, evalScore?: number): MoveRecord {
    return {
        uci,
        piece: 'C',
        captured: '',
        evalScore,
        board,
        sideToMove: ply % 2 === 0 ? 'w' : 'b',
        inCheck: false,
        ply,
    };
}

const render = (props: Parameters<typeof EvalGraph>[0]) => renderToStaticMarkup(<EvalGraph {...props} />);

describe('graph peaks preserve the ordering of score kinds', () => {
    it('ranks forced mates beyond even very large centipawn evaluations', () => {
        const history = [move('h2e2', 1, 40000), move('h9g7', 2, 29997), move('b0c2', 3, -50000), move('b9c7', 4, -29996)];
        const html = render({ history, currentMoveIndex: 3, currentEval: null });
        expect(html).toContain('Peak Red +M3');
        expect(html).toContain('Peak Black +M4');
    });
    it('distinguishes mates from centipawn readings with the same stored number', () => {
        const history = [{ ...move('h2e2', 1, 20000), evalScoreKind: 'cp' as const }, move('h9g7', 2, 20000),
            { ...move('b0c2', 3, -20000), evalScoreKind: 'cp' as const }, move('b9c7', 4, -20000)];
        const html = render({ history, currentMoveIndex: 3, currentEval: null });
        expect(html).toContain('Peak Red +M10000');
        expect(html).toContain('Peak Black +M10000');
    });
    it('uses shortest mates for each side, including mate zero and a live cp reading', () => {
        const history = [move('h2e2', 1, 29990), move('h9g7', 2, 30000), move('b0c2', 3, -29999), move('b9c7', 4, -30000)];
        const html = render({ history, currentMoveIndex: -1, currentEval: 50000, currentEvalKind: 'cp', isSearching: true });
        expect(html).toContain('Peak Red +M0');
        expect(html).toContain('Peak Black +M0');
    });
});

describe('EvalGraph and a score that is not a number', () => {
    // A single NaN used to take out the whole graph rather than one point: it
    // reached the `d` attribute, where SVG discards the entire path, and it
    // poisoned the min/max extent, which took the axis with it.
    const withNaN = [move('h2e2', 1, 40), move('h7e7', 2, Number.NaN), move('b0c2', 3, 55)];

    it('keeps the line drawable', () => {
        const html = render({ history: withNaN, currentMoveIndex: 2, currentEval: 55 });
        const paths = html.match(/ d="[^"]*"/g) ?? [];
        expect(paths.length).toBeGreaterThan(0);
        for (const path of paths) expect(path).not.toContain('NaN');
    });

    it('keeps the extent readable instead of reporting NaN', () => {
        const html = render({ history: withNaN, currentMoveIndex: 2, currentEval: 55 });
        expect(html).not.toContain('NaN');
    });

    it('does not assign the previous score to an invalid reading', () => {
        const html = render({ history: withNaN, currentMoveIndex: 1, currentEval: null });
        expect(html).toContain('<strong>Not evaluated</strong>');
        expect(html).toContain('ply 2, Not evaluated');
    });

    it('ignores a non-finite live evaluation too', () => {
        const html = render({
            history: [move('h2e2', 1, 40)],
            currentMoveIndex: 0,
            currentEval: Number.POSITIVE_INFINITY,
            isSearching: true,
        });
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('Infinity');
    });

    it('still draws a graph when nothing has been evaluated at all', () => {
        const html = render({
            history: [move('h2e2', 1), move('h7e7', 2)],
            currentMoveIndex: 1,
            currentEval: null,
        });
        expect(html).not.toContain('NaN');
    });
});

describe('bounded graph readings', () => {
    const bound = 'Lower bound, not an exact score';
    it('identifies a live bound without inventing peaks or a swing', () => {
        const html = render({ history: [], currentMoveIndex: -1, currentEval: 150, currentEvalBoundText: bound, isSearching: true });
        expect(html).toContain('Red POV +1.50 · Bound');
        expect(html).toContain('Red POV evaluation +1.50, Lower bound, not an exact score');
        expect(html).toContain('title="Lower bound, not an exact score"');
        expect(html).not.toContain('class="graph-tooltip"');
        expect(html).toContain('graph-point-bound');
        expect(html).toContain('Peak Red n/a');
        expect(html).toContain('Peak Black n/a');
        expect(html).toContain('<span>Swing</span><strong>n/a</strong>');
    });
    it('uses only exact positions for the peaks and swing', () => {
        const html = render({ history: [move('h2e2', 1, -400), move('h9g7', 2, 200), move('b0c2', 3)], currentMoveIndex: 2,
            currentEval: 29997, currentEvalBoundText: bound, isSearching: true });
        expect(html).toContain('Red POV +M3 · Bound');
        expect(html).toContain('Peak Red +2.00');
        expect(html).toContain('Peak Black +4.00');
        expect(html).toContain('<span>Swing</span><strong>+6.00</strong>');
    });
    it('preserves a stored exact reading during a bounded search', () => {
        const html = render({ history: [{ ...move('h2e2', 1, 29997), evalScoreKind: 'cp' }], currentMoveIndex: 0,
            currentEval: 150, currentEvalBoundText: bound, isSearching: true });
        expect(html).toContain('Red POV +299.97');
        expect(html).not.toContain('Bound');
        expect(html).not.toContain('+M3');
    });
    it('removes bound metadata when the same score becomes exact', () => {
        const html = render({ history: [], currentMoveIndex: -1, currentEval: 150, isSearching: true });
        expect(html).toContain('Red POV +1.50');
        expect(html).toContain('Peak Red +1.50');
        expect(html).not.toContain('graph-point-bound');
        expect(html).not.toContain('graph-bound-note');
    });
});

describe('unevaluated graph positions', () => {
    it('does not call an unscored move equal or reuse the preceding evaluation', () => {
        const html = render({ history: [move('h2e2', 1, 400), move('h9g7', 2)], currentMoveIndex: 1, currentEval: null });
        expect(html).toContain('<strong>Not evaluated</strong>');
        expect(html).toContain('ply 2, Not evaluated');
        expect(html).not.toContain('ply 2, Red POV evaluation +4.00');
    });
    it('does not invent zero at an unknown root or include it in the extrema', () => {
        const html = render({ history: [move('h2e2', 1, 400)], currentMoveIndex: -1, currentEval: null });
        expect(html).toContain('Start position, Not evaluated');
        expect(html).toContain('Peak Black -4.00');
        expect(html).not.toContain('Red POV 0.00');
    });
    it('has no score peaks or graph line when every position is unknown', () => {
        const html = render({ history: [move('h2e2', 1), move('h9g7', 2)], currentMoveIndex: 1, currentEval: null });
        expect(html).toContain('Peak Red n/a');
        expect(html).toContain('Peak Black n/a');
        expect(html).toContain('class="graph-line" d=""');
    });
    it('breaks the drawn line and shaded area at missing scores', () => {
        const html = render({ history: [move('h2e2', 1, 40), move('h9g7', 2), move('b0c2', 3, -50)], currentMoveIndex: 1, currentEval: null });
        const line = html.match(/class="graph-line" d="([^"]*)"/)?.[1] ?? '';
        expect(line.match(/M /g)).toHaveLength(2);
        expect(line).not.toContain('L ');
        const fill = html.match(/class="graph-area" d="([^"]*)"/)?.[1] ?? '';
        expect(fill.match(/M /g)).toHaveLength(2);
        expect(fill.match(/Z/g)).toHaveLength(2);
    });
    it('shows a real zero and allows a live score to fill the active gap only', () => {
        const history = [move('h2e2', 1, 0), move('h9g7', 2)];
        const zero = render({ history, currentMoveIndex: 0, currentEval: null });
        expect(zero).toContain('<strong>Red POV 0.00</strong>');
        const live = render({ history, currentMoveIndex: 1, currentEval: 75, isSearching: true });
        expect(live).toContain('<strong>Red POV +0.75</strong>');
        expect(live).toContain('Start');
        expect(live).not.toContain('NaN');
    });
});

/**
 * Two marks on the graph that no test named.
 *
 * A point the engine never scored is drawn differently from one it did, and
 * each point's accessible label carries the winning-chance drop for the move
 * that reached it -- except the start, where nobody has moved yet. Found by
 * mutation: inverting either condition passed the whole suite.
 */
describe('what the graph marks on each point', () => {
    const unknownPoints = (html: string) => (html.match(/graph-point-unknown/g) ?? []).length;

    it('marks only the positions with no evaluation as unknown', () => {
        const history = [move('h2e2', 1, 40), move('h9g7', 2), move('b0c2', 3, -60), move('b9c7', 4)];
        const html = render({ history, currentMoveIndex: 3, currentEval: null });
        // Counted, not merely present: inverting the test moves the class onto
        // the evaluated points instead, and "contains" would still pass.
        // Three: the two unscored moves, and the start, which no search ever
        // reaches because no move has been played there.
        expect(unknownPoints(html)).toBe(3);
    });

    it('marks only the start when every move was scored', () => {
        const history = [move('h2e2', 1, 40), move('h9g7', 2, -10), move('b0c2', 3, -60)];
        expect(unknownPoints(render({ history, currentMoveIndex: 2, currentEval: null }))).toBe(1);
    });

    /** The slider's spoken description of the point the reader is on. */
    const valueText = (html: string) => html.match(/aria-valuetext="([^"]*)"/)?.[1] ?? '';

    it('states the winning-chance drop in the point description', () => {
        // Scoped to `aria-valuetext`, not to the whole document: the tooltip
        // carries the same sentence in its own `aria-label`, so a loose
        // `toContain` passes even when the description drops it entirely.
        const history = [
            move('h2e2', 1, 40),
            { ...move('h9g7', 2, -600), winPercentLoss: 32.5 },
        ];
        const html = render({ history, currentMoveIndex: 1, currentEval: null });
        expect(valueText(html)).toContain('advantage indicator dropped by');
    });

    it('says nothing about a drop on a move no review has graded', () => {
        // Every move before the reader runs a review. Without both halves of
        // the test, the description reports a drop "by 0 percentage points"
        // for a move nothing has measured.
        const history = [move('h2e2', 1, 40), move('h9g7', 2, -60)];
        const html = render({ history, currentMoveIndex: 1, currentEval: null });
        expect(valueText(html)).toContain('H9→G7');
        expect(valueText(html)).not.toContain('advantage indicator dropped by');
    });

    it('says nothing about a drop at the start, where nobody has moved', () => {
        const history = [{ ...move('h2e2', 1, -600), winPercentLoss: 32.5 }];
        const html = render({ history, currentMoveIndex: -1, currentEval: null });
        expect(valueText(html)).toContain('Start position');
        expect(valueText(html)).not.toContain('advantage indicator dropped by');
    });
});
