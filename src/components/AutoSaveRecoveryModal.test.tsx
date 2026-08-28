import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AutoSaveRecoveryModal } from './AutoSaveRecoveryModal';

const noop = vi.fn();
const NOW = Date.now();

function render(overrides: Partial<Parameters<typeof AutoSaveRecoveryModal>[0]> = {}) {
    return renderToStaticMarkup(
        <AutoSaveRecoveryModal
            savedAt={NOW - 5 * 60_000}
            moveCount={12}
            onRestore={noop}
            onDismiss={noop}
            {...overrides}
        />
    );
}

describe('AutoSaveRecoveryModal', () => {
    it('announces itself as a modal dialog with a name and a description', () => {
        const html = render();
        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('aria-labelledby="auto-save-title"');
        expect(html).toContain('aria-describedby="auto-save-subtitle"');
        expect(html).toContain('id="auto-save-title"');
        expect(html).toContain('id="auto-save-subtitle"');
    });

    it('says how much work is at stake and how old it is', () => {
        expect(render()).toContain('12 moves were in progress 5 minutes ago');
    });

    it('counts a single move in the singular', () => {
        expect(render({ moveCount: 1 })).toContain('1 move was in progress');
    });

    it('describes a position when there are no moves to count', () => {
        const html = render({ moveCount: 0 });
        expect(html).toContain('A position was in progress');
        expect(html).not.toContain('0 moves');
    });

    it('reads a fresh snapshot as just now, and an old one in the largest unit', () => {
        expect(render({ savedAt: NOW })).toContain('moments ago');
        expect(render({ savedAt: NOW - 3 * 3_600_000 })).toContain('3 hours ago');
        expect(render({ savedAt: NOW - 2 * 86_400_000 })).toContain('2 days ago');
    });

    it('does not claim a snapshot came from the future', () => {
        expect(render({ savedAt: NOW + 3_600_000 })).toContain('recently');
    });

    it('offers restoring as the primary action', () => {
        const html = render();
        expect(html).toContain('auto-save-btn-primary');
        expect(html).toContain('Restore');
        expect(html).toContain('Start fresh');
    });
});
