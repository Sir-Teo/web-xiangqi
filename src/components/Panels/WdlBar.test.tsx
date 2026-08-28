import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WdlBar } from './WdlBar';

const render = (props: Parameters<typeof WdlBar>[0]) => renderToStaticMarkup(<WdlBar {...props} />);

describe('WdlBar', () => {
    it('says the estimate is unavailable rather than showing an empty bar', () => {
        const html = render({ wdl: null });
        expect(html).toContain('role="img"');
        expect(html).toContain('aria-label="Win/draw/loss estimate unavailable"');
        expect(html).toContain('Red —');
        expect(html).toContain('Draw —');
        expect(html).toContain('Black —');
    });

    it('reads the split out for a screen reader', () => {
        const html = render({ wdl: { win: 250, draw: 500, loss: 250 } });
        expect(html).toContain('aria-label="Win/draw/loss estimate: Red 25.0%, Draw 50.0%, Black 25.0%"');
    });

    it('sizes each segment to its share', () => {
        const html = render({ wdl: { win: 250, draw: 500, loss: 250 } });
        expect(html).toContain('width:25%');
        expect(html).toContain('width:50%');
    });

    it('marks a live search so it can be styled as provisional', () => {
        expect(render({ wdl: { win: 1, draw: 1, loss: 1 }, isSearching: true })).toContain('wdl-bar-live');
        expect(render({ wdl: { win: 1, draw: 1, loss: 1 } })).not.toContain('wdl-bar-live');
    });

    it('treats a reading that says nothing as no reading', () => {
        expect(render({ wdl: { win: 0, draw: 0, loss: 0 } }))
            .toContain('Win/draw/loss estimate unavailable');
    });

    it('never prints NaN, whatever the engine reported', () => {
        for (const wdl of [
            { win: Number.NaN, draw: 1, loss: 1 },
            { win: 1, draw: Number.NaN, loss: 1 },
            { win: 1, draw: 1, loss: Number.NaN },
            { win: Number.POSITIVE_INFINITY, draw: 1, loss: 1 },
            { win: -5, draw: 10, loss: 5 },
        ]) {
            const html = render({ wdl });
            expect(html).not.toContain('NaN');
            expect(html).toContain('Win/draw/loss estimate unavailable');
        }
    });
});
