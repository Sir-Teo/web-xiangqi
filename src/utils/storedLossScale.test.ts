import { describe, expect, it } from 'vitest';
import { MAX_REPORTED_CENTIPAWN_LOSS } from './review';
import { normalizeSavedGames } from './gameLibrary';

/**
 * Reviews saved before the per-move bound existed hold averages on the old,
 * unbounded scale — the same game that now scores 525 was stored as 5017. The
 * library sorts by this value and averages it across games, so a stored record
 * must not be able to exceed what a fresh review could produce.
 */
function libraryWith(averageCentipawnLoss: number) {
    return ([{
        id: 'g1',
        name: 'Saved game',
        savedAt: 1_700_000_000_000,
        gameMode: 'PvP',
        moves: ['h2e2', 'h9g7'],
        result: 'red-wins',
        review: {
            summary: {
                totalMoves: 2,
                accuracy: 80,
                averageCentipawnLoss,
                redAverageCentipawnLoss: averageCentipawnLoss,
                bestCount: 1, goodCount: 1,
                inaccuracyCount: 0, mistakeCount: 0, blunderCount: 0,
                reviewedAt: 1_700_000_000_000,
                lineSignature: 'x',
                keyMoments: [],
            },
            annotations: [],
        },
    }]);
}

const summaryOf = (raw: unknown) => normalizeSavedGames(raw)[0]?.review?.summary;

describe('reading a stored average loss', () => {
    it('keeps an ordinary saved value exactly as it was', () => {
        expect(summaryOf(libraryWith(120))?.averageCentipawnLoss).toBe(120);
    });

    it('brings a pre-bound record onto the current scale', () => {
        // 5017 is what a six-move review with one forced mate used to store.
        expect(summaryOf(libraryWith(5017))?.averageCentipawnLoss)
            .toBe(MAX_REPORTED_CENTIPAWN_LOSS);
    });

    it('does the same for the per-side average', () => {
        expect(summaryOf(libraryWith(30000))?.redAverageCentipawnLoss)
            .toBe(MAX_REPORTED_CENTIPAWN_LOSS);
    });

    it('never lets a stored record beat what a fresh review could produce', () => {
        for (const stored of [0, 999, 1000, 1001, 5017, 30000, 100000]) {
            const value = summaryOf(libraryWith(stored))?.averageCentipawnLoss as number;
            expect(value).toBeLessThanOrEqual(MAX_REPORTED_CENTIPAWN_LOSS);
        }
    });
});
