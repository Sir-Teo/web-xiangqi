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

    it('does not let a bad score become the value carried forward', () => {
        // The ply with no usable score reads as the one before it, which is
        // what the graph already does for a ply nothing has evaluated.
        const html = render({ history: withNaN, currentMoveIndex: 1, currentEval: null });
        expect(html).toContain('+0.40');
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
