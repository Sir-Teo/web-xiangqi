import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewPanel } from './ReviewPanel';
import type { PhaseAccuracySummary, ReviewSummary } from '../../utils/review';

const SUMMARY: ReviewSummary = {
    totalMoves: 30,
    accuracy: 88,
    redAccuracy: 91,
    blackAccuracy: 85,
    bestCount: 20,
    goodCount: 6,
    inaccuracyCount: 2,
    mistakeCount: 1,
    blunderCount: 1,
    reviewedAt: 1_700_000_000_000,
    lineSignature: 'sig',
    keyMoments: [],
};

const noop = () => {};

function render(phaseAccuracy: PhaseAccuracySummary[]) {
    return renderToStaticMarkup(
        <ReviewPanel
            status="done"
            progress={1}
            summary={SUMMARY}
            phaseAccuracy={phaseAccuracy}
            currentNodeId="root"
            canStart={false}
            onStart={noop}
            onCancel={noop}
            onClear={noop}
            onNavigateNode={noop}
        />,
    );
}

const phase = (over: Partial<PhaseAccuracySummary>): PhaseAccuracySummary => ({
    phase: 'opening',
    label: 'Opening',
    accuracy: 90,
    redAccuracy: 92,
    blackAccuracy: 88,
    moves: 20,
    ...over,
});

describe('the phase breakdown in the review panel', () => {
    it('says nothing about a game that never left one phase', () => {
        // A lone bar would repeat the overall figure without adding to it.
        const html = render([phase({})]);
        expect(html).not.toContain('Accuracy by phase');
    });

    it('says nothing when there was no review to break down', () => {
        expect(render([])).not.toContain('Accuracy by phase');
    });

    it('breaks the game down once it spans more than one phase', () => {
        const html = render([
            phase({}),
            phase({ phase: 'endgame', label: 'Endgame', redAccuracy: 70, blackAccuracy: 65, moves: 10 }),
        ]);
        expect(html).toContain('aria-label="Accuracy by phase"');
        expect(html).toContain('Opening');
        expect(html).toContain('Endgame');
        expect(html).toContain('92%');
        expect(html).toContain('70%');
    });

    it('names the side and the phase together, so the figures are not just numbers', () => {
        const html = render([phase({}), phase({ phase: 'endgame', label: 'Endgame', moves: 4 })]);
        expect(html).toContain('Red accuracy in the opening 92%');
        expect(html).toContain('Black accuracy in the endgame 88%');
    });

    it('leaves out a side that never moved in a phase', () => {
        const html = render([
            phase({}),
            phase({ phase: 'endgame', label: 'Endgame', blackAccuracy: undefined, moves: 1 }),
        ]);
        expect(html).not.toContain('Black accuracy in the endgame');
        expect(html).toContain('Red accuracy in the endgame');
    });

    it('counts the moves, with the singular spelt out', () => {
        const html = render([
            phase({ moves: 20 }),
            phase({ phase: 'endgame', label: 'Endgame', moves: 1 }),
        ]);
        expect(html).toContain('20 moves');
        expect(html).toContain('1 move<');
    });
});
