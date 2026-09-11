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
