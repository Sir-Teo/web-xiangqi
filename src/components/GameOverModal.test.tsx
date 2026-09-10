import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GameOverModal } from './GameOverModal';
import { BLACK_GENERAL_GLYPH, RED_GENERAL_GLYPH, pieceLabel } from '../utils/pieceStyle';

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

    /**
     * The disc showed the *loser's* general on the winner's colour: "Red Wins"
     * with 將, which is Black's, on a red disc. Both glyphs are taken from
     * `pieceStyle`'s traditional set now, so this compares against the same
     * source the board draws from rather than against a second copy that could
     * be swapped the same way.
     */
    it('shows the winner their own general', () => {
        const red = render({ result: 'red-wins' });
        expect(red).toContain(RED_GENERAL_GLYPH);
        expect(red).not.toContain(BLACK_GENERAL_GLYPH);

        const black = render({ result: 'black-wins' });
        expect(black).toContain(BLACK_GENERAL_GLYPH);
        expect(black).not.toContain(RED_GENERAL_GLYPH);
    });

    it('keeps the two generals distinct, which is the whole point of the check above', () => {
        expect(RED_GENERAL_GLYPH).not.toBe(BLACK_GENERAL_GLYPH);
        expect(pieceLabel('K', 'traditional')).toBe(RED_GENERAL_GLYPH);
        expect(pieceLabel('k', 'traditional')).toBe(BLACK_GENERAL_GLYPH);
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
