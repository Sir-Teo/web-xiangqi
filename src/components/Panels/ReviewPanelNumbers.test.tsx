import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewPanel } from './ReviewPanel';
import type { ReviewKeyMoment, ReviewSummary } from '../../utils/review';

/**
 * Nothing on this panel may render as "NaN".
 *
 * Every number here arrives from arithmetic over engine output, and the panel
 * formats a lot of them: accuracy, per-side accuracy, average centipawn loss,
 * swings, evaluation transitions, winning-chance losses. Some of the formatters
 * guard against a non-finite value and some do not, which is the same split the
 * eval graph had -- there, one bad value erased the whole chart.
 *
 * This asserts the property rather than auditing each formatter, so a new
 * unguarded one is caught by existing tests rather than by a screenshot.
 */

const moment = (extra: Partial<ReviewKeyMoment> = {}): ReviewKeyMoment => ({
    nodeId: 'n1', moveIndex: 0, jumpTarget: 0, ply: 1, side: 'red',
    quality: 'blunder', swing: 400, evalBefore: 40, evalAfter: -360,
    playedMove: 'h2e2', bestMove: 'b0c2', note: 'A note.', ...extra,
});

const summary = (extra: Partial<ReviewSummary> = {}): ReviewSummary => ({
    totalMoves: 10, accuracy: 62, bestCount: 3, goodCount: 4,
    inaccuracyCount: 1, mistakeCount: 1, blunderCount: 1,
    reviewedAt: new Date(2026, 7, 31, 12).getTime(),
    lineSignature: 'h2e2 h9g7', keyMoments: [moment()], ...extra,
});

const render = (over: Partial<ReviewSummary>, moments: ReviewKeyMoment[] = [moment()]) =>
    renderToStaticMarkup(
        <ReviewPanel
            status="done"
            progress={1}
            summary={summary({ ...over, keyMoments: moments })}
            currentNodeId="n1"
            canStart
            onStart={() => {}}
            onCancel={() => {}}
            onClear={() => {}}
            onNavigateNode={() => {}}
        />
    );

const BAD = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('a review panel handed numbers that are not numbers', () => {
    it('renders a normal review without complaint', () => {
        const html = render({});
        expect(html).not.toContain('NaN');
        expect(html).toContain('62');
    });

    it('never writes NaN for a bad accuracy', () => {
        for (const value of BAD) {
            const html = render({ accuracy: value, redAccuracy: value, blackAccuracy: value });
            expect(html, `accuracy ${value}`).not.toContain('NaN');
            expect(html, `accuracy ${value}`).not.toContain('Infinity');
        }
    });

    it('never writes NaN for a bad centipawn average', () => {
        for (const value of BAD) {
            const html = render({
                averageCentipawnLoss: value,
                redAverageCentipawnLoss: value,
                blackAverageCentipawnLoss: value,
            });
            expect(html, `loss ${value}`).not.toContain('NaN');
            expect(html, `loss ${value}`).not.toContain('Infinity');
        }
    });

    it('never writes NaN for a key moment whose numbers are broken', () => {
        for (const value of BAD) {
            const html = render({}, [moment({
                swing: value, evalBefore: value, evalAfter: value, winPercentLoss: value,
            })]);
            expect(html, `moment ${value}`).not.toContain('NaN');
            expect(html, `moment ${value}`).not.toContain('Infinity');
        }
    });

    it('never writes NaN for a review with no moves at all', () => {
        const html = render({ totalMoves: 0, accuracy: 0, keyMoments: [] }, []);
        expect(html).not.toContain('NaN');
    });
});
