import { describe, expect, it } from 'vitest';
import { filterKeyMoments } from './review';
import type { KeyMomentFilters, ReviewKeyMoment } from './review';
import type { GamePhase } from './gamePhase';

const moment = (over: Partial<ReviewKeyMoment>): ReviewKeyMoment => ({
    nodeId: 'n', moveIndex: 0, jumpTarget: 0, ply: 1, side: 'red',
    quality: 'mistake', swing: 100, evalBefore: 0, evalAfter: -100,
    playedMove: 'a0a1', note: '', ...over,
});

/** Four moments: two in the opening, two in the endgame, split by side. */
const MOMENTS = [
    moment({ moveIndex: 0, side: 'red', quality: 'mistake' }),
    moment({ moveIndex: 1, side: 'black', quality: 'blunder' }),
    moment({ moveIndex: 2, side: 'red', quality: 'blunder' }),
    moment({ moveIndex: 3, side: 'black', quality: 'inaccuracy' }),
];
const PHASES: Array<GamePhase | null> = ['opening', 'opening', 'endgame', 'endgame'];
const ALL: KeyMomentFilters = { side: 'all', quality: 'all', phase: 'all' };

describe('narrowing the key moments', () => {
    it('leaves everything alone by default', () => {
        expect(filterKeyMoments(MOMENTS, ALL, PHASES)).toHaveLength(4);
    });

    it('keeps only the moments from the chosen phase', () => {
        const endgame = filterKeyMoments(MOMENTS, { ...ALL, phase: 'endgame' }, PHASES);
        expect(endgame.map((m) => m.moveIndex)).toEqual([2, 3]);
    });

    it('combines the phase with the other filters rather than replacing them', () => {
        const redEndgame = filterKeyMoments(MOMENTS, { ...ALL, side: 'red', phase: 'endgame' }, PHASES);
        expect(redEndgame.map((m) => m.moveIndex)).toEqual([2]);
    });

    it('drops a moment whose phase is unknown rather than guessing', () => {
        // A record with no board yields null, which matches no phase.
        expect(filterKeyMoments(MOMENTS, { ...ALL, phase: 'opening' }, [null, null, null, null]))
            .toEqual([]);
    });

    it('narrows to nothing when no phase information was supplied', () => {
        expect(filterKeyMoments(MOMENTS, { ...ALL, phase: 'opening' })).toEqual([]);
    });

    it('ignores missing phase information while no phase is chosen', () => {
        // The other filters must keep working before a phase is ever picked.
        // Named, not counted: this fixture holds two blunders out of four, so
        // a quality filter inverted to keep everything it should drop returns
        // two moments as well. Found by mutation -- the length assertion alone
        // let `moment.quality !== filters.quality` flip to `===` and pass, and
        // that is the reader choosing "Blunders" and being shown the rest.
        expect(filterKeyMoments(MOMENTS, { ...ALL, quality: 'blunder' }).map((m) => m.moveIndex))
            .toEqual([1, 2]);
    });

    it('keeps the chosen quality for every band, not only the common one', () => {
        for (const [quality, expected] of [
            ['mistake', [0]], ['blunder', [1, 2]], ['inaccuracy', [3]],
        ] as const) {
            expect(filterKeyMoments(MOMENTS, { ...ALL, quality }, PHASES).map((m) => m.moveIndex))
                .toEqual(expected);
        }
    });

    it('accounts for every moment across the phases', () => {
        const counted = (['opening', 'endgame'] as const)
            .reduce((total, phase) => total + filterKeyMoments(MOMENTS, { ...ALL, phase }, PHASES).length, 0);
        expect(counted).toBe(MOMENTS.length);
    });
});
