import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutoSaveRecoveryModal } from './AutoSaveRecoveryModal';

/**
 * The dismiss button does two different things and used to have one name.
 *
 * Opened cold, dismissing starts an empty board, and "Start fresh" describes
 * that exactly. Opened by following a shared link, the link's game is already
 * on the board -- so dismissing *keeps* it and restoring *discards* it. Under
 * the old label a reader who wanted the link they had just clicked had every
 * reason to press Restore, which was the button that threw it away.
 */

const render = (props: Partial<Parameters<typeof AutoSaveRecoveryModal>[0]> = {}) =>
    renderToStaticMarkup(
        <AutoSaveRecoveryModal
            savedAt={Date.now() - 30_000}
            moveCount={3}
            onRestore={() => {}}
            onDismiss={() => {}}
            {...props}
        />
    );

describe('the unfinished-game prompt', () => {
    it('offers a fresh board when the reader arrived cold', () => {
        const html = render();
        expect(html).toContain('Start fresh');
        expect(html).toContain('Pick it up where you left off?');
        expect(html).not.toContain('link');
    });

    it('offers to keep the link when the reader followed one', () => {
        const html = render({ incomingLink: { moveCount: 5 } });
        expect(html).toContain("Keep the link&#x27;s game");
        expect(html).not.toContain('Start fresh');
    });

    it('says what restoring would cost, in moves', () => {
        expect(render({ incomingLink: { moveCount: 5 } }))
            .toContain('Restoring it replaces the 5-move game this link opened.');
    });

    it('describes a link that carries a position rather than moves', () => {
        expect(render({ incomingLink: { moveCount: 0 } }))
            .toContain('Restoring it replaces the position this link opened.');
    });

    it('still counts the saved game correctly either way', () => {
        expect(render({ moveCount: 1 })).toContain('1 move was in progress');
        expect(render({ moveCount: 1, incomingLink: { moveCount: 2 } })).toContain('1 move was in progress');
    });

    it('keeps Restore as the button that carries focus', () => {
        // Restore stays the default: it is the one that protects work the
        // reader has not saved anywhere else.
        const html = render({ incomingLink: { moveCount: 5 } });
        expect(html.indexOf('Restore')).toBeLessThan(html.indexOf("Keep the link"));
    });
});
