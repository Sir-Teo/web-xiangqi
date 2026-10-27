import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutoSaveRecoveryModal } from './AutoSaveRecoveryModal';
import type { RecoveryDraft } from '../utils/autoSaveDrafts';

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
            onLater={() => {}}
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

    it('keeps Restore first in the action order', () => {
        const html = render({ incomingLink: { moveCount: 5 } });
        expect(html.indexOf('Restore')).toBeLessThan(html.indexOf("Keep the link"));
    });

    it('identifies recovery choices using their saved names, events, players or openings', () => {
        const drafts: RecoveryDraft[] = [
            { label: 'My preparation', metadata: { event: 'Club final' } },
            { metadata: { event: 'Club final', redPlayer: 'Alice', blackPlayer: '王' } },
            { metadata: { redPlayer: 'Alice', blackPlayer: '王' } },
            { opening: 'Central Cannon' }, {},
        ].map((extra, index) => ({ version: 1, draftId: String(index), savedAt: 1,
            game: { id: String(index), savedAt: 1, gameMode: 'PvP', moves: index === 0 ? ['h2e2'] : [], ...extra } }));
        const html = render({ drafts, draftId: '2' });
        expect(html).toContain('My preparation · 1 move ·');
        expect(html).not.toContain('1 moves');
        expect(html).toContain('Club final · 0 moves ·');
        expect(html).toContain('Alice · 王 · 0 moves ·');
        expect(html).toContain('Central Cannon · 0 moves ·');
        expect(html).toContain('Unfinished study · 0 moves ·');
        expect(html).toContain('aria-describedby="auto-save-draft-details"');
        expect(html).toContain('id="auto-save-draft-details" class="auto-save-draft-details">Alice · 王</p>');
    });
});

/**
 * When the game was saved, in words.
 *
 * Found by mutation: every boundary in `describeWhen` -- `minutes < 1`,
 * `minutes < 60`, `hours < 24` -- could move by one with the suite green,
 * because the only fixture was 30 seconds old. Moved, the prompt tells the
 * reader their unfinished game is from "moments ago" when it is an hour old,
 * which is the one fact on this dialog they use to decide whether they want it
 * back.
 *
 * Each case sits a little past its boundary rather than exactly on it: the
 * component reads the real clock, so a value pinned to the exact millisecond
 * would flip whenever the test straddled it.
 */
describe('how long ago the game was saved', () => {
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    const when = (agoMs: number) => render({ savedAt: Date.now() - agoMs });

    it.each([
        ['under a minute', 30_000, 'moments ago'],
        ['just past a minute', MINUTE + 1_000, '1 minute ago'],
        ['a few minutes', 5 * MINUTE, '5 minutes ago'],
        ['just under an hour', 59 * MINUTE, '59 minutes ago'],
        ['just past an hour', HOUR + 1_000, '1 hour ago'],
        ['just under a day', 23 * HOUR, '23 hours ago'],
        ['just past a day', 24 * HOUR + 1_000, '1 day ago'],
        ['several days', 3 * 24 * HOUR, '3 days ago'],
    ])('reads %s as "%s"', (_label, agoMs, expected) => {
        expect(when(agoMs)).toContain(expected);
    });

    it('does not guess when the clock disagrees', () => {
        // A saved time in the future -- a machine whose clock moved back, or a
        // file copied between devices.
        expect(when(-5 * MINUTE)).toContain('recently');
    });
});
