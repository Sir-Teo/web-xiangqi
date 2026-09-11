import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewPanel } from './ReviewPanel';

/**
 * What a reader is told while a review is running.
 *
 * A percentage alone says nothing about the scale, and the scale is the whole
 * question on a long game: at roughly a second a position, a 240-move game is
 * nearly four minutes of "42%". The count is the same fact at a resolution
 * that answers "how much longer".
 */
const running = (props: { progress: number; progressCompleted?: number; progressTotal?: number }) =>
    renderToStaticMarkup(
        <ReviewPanel
            status="running"
            summary={null}
            currentNodeId="n1"
            canStart={false}
            onStart={() => {}}
            onCancel={() => {}}
            onClear={() => {}}
            onNavigateNode={() => {}}
            {...props}
        />
    );

describe('a running review', () => {
    it('says how many positions it has searched and how many there are', () => {
        const html = running({ progress: 104 / 241, progressCompleted: 104, progressTotal: 241 });
        expect(html).toContain('104 of 241 positions');
        expect(html).toContain('43% complete');
    });

    it('tells a screen reader the same thing the sighted reader gets', () => {
        const html = running({ progress: 104 / 241, progressCompleted: 104, progressTotal: 241 });
        expect(html).toContain('aria-valuetext="43% complete, 104 of 241 positions"');
    });

    it('falls back to the percentage alone when there is no count to give', () => {
        const html = running({ progress: 0.5 });
        expect(html).toContain('50% complete');
        expect(html).not.toContain('positions');
        expect(html).toContain('aria-valuetext="50% complete"');
    });

    it('does not show a count at all once the review is not running', () => {
        const html = renderToStaticMarkup(
            <ReviewPanel
                status="idle"
                progress={0}
                progressCompleted={104}
                progressTotal={241}
                summary={null}
                currentNodeId="n1"
                canStart
                onStart={() => {}}
                onCancel={() => {}}
                onClear={() => {}}
                onNavigateNode={() => {}}
            />
        );
        expect(html).not.toContain('of 241 positions');
    });
});

describe('a review of a line the board has left', () => {
    const done = (props: Record<string, unknown>) =>
        renderToStaticMarkup(
            <ReviewPanel
                status="done"
                progress={1}
                summary={{
                    totalMoves: 6, accuracy: 94, averageCentipawnLoss: 20,
                    bestCount: 5, goodCount: 1, inaccuracyCount: 0, mistakeCount: 0, blunderCount: 0,
                    reviewedAt: 1710000009000, lineSignature: 'h2e2 h9g7', keyMoments: [],
                }}
                currentNodeId="n1"
                canStart
                onStart={() => {}}
                onCancel={() => {}}
                onClear={() => {}}
                onNavigateNode={() => {}}
                {...props}
            />
        );

    it('says so, because the figures no longer describe what is on the board', () => {
        const html = done({ onReviewedLine: false });
        expect(html).toContain('review-off-line');
        expect(html).toContain('has left the line');
    });

    it('keeps the figures anyway -- they are the reviewed game\'s, and still wanted', () => {
        const html = done({ onReviewedLine: false });
        expect(html).toContain('94%');
    });

    it('says nothing when the board is on the reviewed line', () => {
        expect(done({ onReviewedLine: true })).not.toContain('review-off-line');
    });

    it('assumes it is on the line when nobody says otherwise', () => {
        // An omitted prop must not turn the notice on for every existing caller.
        expect(done({})).not.toContain('review-off-line');
    });

    it('says nothing before a review has run', () => {
        const html = renderToStaticMarkup(
            <ReviewPanel
                status="idle"
                progress={0}
                summary={null}
                currentNodeId="n1"
                canStart
                onReviewedLine={false}
                onStart={() => {}}
                onCancel={() => {}}
                onClear={() => {}}
                onNavigateNode={() => {}}
            />
        );
        expect(html).not.toContain('review-off-line');
    });
});
