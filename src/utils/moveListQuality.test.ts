import { describe, expect, it } from 'vitest';
import { getMoveListQuality } from './moveListQuality';

const red = { uci: 'h2e2', piece: 'C', ply: 1 };
const black = { uci: 'h9g7', piece: 'n', ply: 2 };

describe('move-list quality estimates', () => {
    it('does not invent an equal score before the first move', () => {
        expect(getMoveListQuality({ ...red, evalScore: -500 })).toBeUndefined();
        expect(getMoveListQuality({ ...black, ply: 1, evalScore: 500 })).toBeUndefined();
    });
    it('requires both finite readings, including in the middle of a line', () => {
        for (const score of [undefined, NaN, Infinity, -Infinity]) {
            expect(getMoveListQuality({ ...red, evalScore: score }, 0)).toBeUndefined();
            expect(getMoveListQuality({ ...red, evalScore: -500 }, score)).toBeUndefined();
        }
        expect(getMoveListQuality(undefined, 0)).toBeUndefined();
    });
    it('accepts a real zero as a score', () => {
        expect(getMoveListQuality({ ...red, evalScore: 0 }, 0)).toBe('best');
        expect(getMoveListQuality({ ...red, evalScore: -500 }, 0)).toBe('blunder');
    });
    it('uses the moving side rather than the new side to move', () => {
        expect(getMoveListQuality({ ...black, evalScore: 0 }, -500)).toBe('blunder');
        expect(getMoveListQuality({ ...red, evalScore: 0 }, -500)).toBe('best');
    });
    it('retains imported or reviewed marks without needing position scores', () => {
        expect(getMoveListQuality({ ...red, quality: 'mistake' })).toBe('mistake');
        expect(getMoveListQuality({ ...red, quality: 'good', evalScore: -500 }, 0)).toBe('good');
    });
});
