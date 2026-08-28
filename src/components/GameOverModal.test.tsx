import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GameOverModal } from './GameOverModal';

const noop = vi.fn();

function render(overrides: Partial<Parameters<typeof GameOverModal>[0]> = {}) {
    return renderToStaticMarkup(
        <GameOverModal result="red-wins" onNewGame={noop} onReview={noop} {...overrides} />
    );
}

describe('GameOverModal', () => {
    it('stays out of the way while the game is still on', () => {
        expect(render({ result: null })).toBe('');
    });

    it('announces itself as a modal dialog with a name and a description', () => {
        const html = render();
        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('aria-labelledby="game-over-title"');
        expect(html).toContain('aria-describedby="game-over-subtitle"');
    });

    it('names each result', () => {
        expect(render({ result: 'red-wins' })).toContain('Red Wins');
        expect(render({ result: 'black-wins' })).toContain('Black Wins');
        expect(render({ result: 'draw' })).toContain('Draw');
    });

    it('says how the game ended when it knows', () => {
        expect(render({ reason: 'checkmate' })).toContain('Checkmate');
        expect(render({ result: 'draw' })).toContain('Game drawn');
    });

    it('explains that xiangqi scores stalemate as a loss', () => {
        const html = render({ reason: 'stalemate' });
        expect(html).toContain('No legal moves');
        expect(html).toContain('Xiangqi counts this as a loss');
    });

    it('falls back to a neutral subtitle for a recorded result', () => {
        expect(render({ reason: 'result' })).toContain('Game result');
    });

    it('offers a new game and a review, with the new game first', () => {
        const html = render();
        expect(html).toContain('New Game');
        expect(html).toContain('Review');
        expect(html.indexOf('New Game')).toBeLessThan(html.indexOf('Review'));
    });

    it('hides the decorative glyph from assistive technology', () => {
        expect(render()).toContain('aria-hidden="true"');
    });
});
