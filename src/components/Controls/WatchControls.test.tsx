import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WatchControls } from './WatchControls';

const noop = vi.fn();

function render(overrides: Partial<Parameters<typeof WatchControls>[0]> = {}) {
    return renderToStaticMarkup(
        <WatchControls
            canGoBack
            canGoForward
            onFirst={noop}
            onPrev={noop}
            onNext={noop}
            onLast={noop}
            gameMode="PvP"
            paused={false}
            onPause={noop}
            onResume={noop}
            onStep={noop}
            aiSpeed="normal"
            onSpeedChange={noop}
            currentMoveIndex={0}
            totalMoves={5}
            onScrub={noop}
            {...overrides}
        />
    );
}

describe('WatchControls navigation', () => {
    it('groups and labels the navigation buttons', () => {
        const html = render();
        expect(html).toContain('role="group"');
        expect(html).toContain('aria-label="Move navigation"');
        expect(html).toContain('aria-label="Go to first position"');
        expect(html).toContain('aria-label="Go to previous move"');
        expect(html).toContain('aria-label="Go to next move"');
    });

    it('disables the direction that has nowhere to go', () => {
        expect(render({ canGoBack: false, canGoForward: true })).toContain('disabled=""');
        const forward = render({ canGoBack: true, canGoForward: false });
        expect(forward).toContain('disabled=""');
    });

    it('names the keyboard shortcut in each title', () => {
        const html = render();
        expect(html).toContain('Previous move (←)');
        expect(html).toContain('Next move (→)');
        expect(html).toContain('First position (↑)');
    });
});

describe('WatchControls move scrubber', () => {
    it('says where in the game the reader is', () => {
        expect(render({ currentMoveIndex: 0, totalMoves: 5 })).toContain('Move 1 of 5 moves');
        expect(render({ currentMoveIndex: 4, totalMoves: 5 })).toContain('Move 5 of 5 moves');
    });

    it('names the start position rather than calling it move zero', () => {
        expect(render({ currentMoveIndex: -1, totalMoves: 5 })).toContain('Start position, 0 of 5 moves');
    });

    it('counts a single move in the singular', () => {
        expect(render({ currentMoveIndex: 0, totalMoves: 1 })).toContain('Move 1 of 1 move');
        expect(render({ currentMoveIndex: 0, totalMoves: 1 })).not.toContain('1 moves');
    });

    it('says there is nothing to scrub through on an empty game', () => {
        expect(render({ currentMoveIndex: -1, totalMoves: 0 })).toContain('No moves');
    });

    it('never reports a position past the end of the game', () => {
        expect(render({ currentMoveIndex: 99, totalMoves: 5 })).toContain('Move 5 of 5 moves');
    });

    it('treats a negative move count as an empty game', () => {
        expect(render({ currentMoveIndex: 0, totalMoves: -3 })).toContain('No moves');
    });
});

describe('WatchControls playback', () => {
    it('offers speed choices and marks the active one', () => {
        const html = render({ gameMode: 'AIvAI', aiSpeed: 'fast' });
        for (const label of ['Slow', 'Normal', 'Fast', 'Step']) {
            expect(html).toContain(label);
        }
        expect(html).toContain('aria-pressed="true"');
    });

    it('does not offer AI playback controls in a human game', () => {
        const html = render({ gameMode: 'PvP' });
        expect(html).not.toContain('aria-label="Pause"');
    });
});
