import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LazyPanelBoundary } from './LazyPanelBoundary';

/**
 * The failure contained here is a lazily loaded panel whose chunk will not
 * fetch — what a tab left open across a deploy sees, since the old chunk
 * filenames are gone. Without the boundary that reaches AppErrorBoundary and
 * replaces the board.
 */
describe('LazyPanelBoundary', () => {
    it('renders its children when nothing is wrong', () => {
        const html = renderToStaticMarkup(
            <LazyPanelBoundary><p>panel</p></LazyPanelBoundary>,
        );
        expect(html).toContain('panel');
        expect(html).not.toContain('could not be loaded');
    });

    it('marks itself failed when a child throws', () => {
        expect(LazyPanelBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    });

    it('warns without rethrowing, so the app keeps running', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const boundary = new LazyPanelBoundary({ children: null });
        expect(() => boundary.componentDidCatch(new Error('chunk'))).not.toThrow();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('says the game is unaffected, which is the reader question', () => {
        const boundary = new LazyPanelBoundary({ children: <p>x</p> });
        boundary.state = { failed: true };
        const html = renderToStaticMarkup(boundary.render() as ReactElement);
        expect(html).toContain('could not be loaded');
        expect(html).toContain('unaffected');
        expect(html).toContain('role="alert"');
    });

    it('stops rendering the children once it has failed', () => {
        const boundary = new LazyPanelBoundary({ children: <p>secret</p> });
        boundary.state = { failed: true };
        expect(renderToStaticMarkup(boundary.render() as ReactElement)).not.toContain('secret');
    });
});
