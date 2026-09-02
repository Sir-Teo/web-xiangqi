import { describe, expect, it } from 'vitest';
import { MATE_SCORE_BASE } from './engineEvalReading';
import { describePvStanding } from './pvStanding';

describe('describePvStanding', () => {
    it('names the first line best whatever its score', () => {
        expect(describePvStanding(30, 30, 0)).toBe('Best');
        expect(describePvStanding(MATE_SCORE_BASE - 2, MATE_SCORE_BASE - 2, 0)).toBe('Best');
    });

    it('calls a line level with the best equal rather than "0.0 behind"', () => {
        expect(describePvStanding(30, 30, 1)).toBe('Equal');
        expect(describePvStanding(30, 27, 1)).toBe('Equal');
    });

    it('prints the gap in pawns once it is worth a decimal', () => {
        expect(describePvStanding(30, 25, 1)).toBe('0.1 behind');
        expect(describePvStanding(120, -40, 2)).toBe('1.6 behind');
    });

    it('never prints a negative gap for a line reported above the best', () => {
        expect(describePvStanding(30, 60, 1)).toBe('Equal');
    });

    it('reads a mate as a kind of answer, not as 298 pawns', () => {
        const mateIn3 = MATE_SCORE_BASE - 3;
        expect(describePvStanding(mateIn3, 150, 1)).toBe('No mate');
        expect(describePvStanding(mateIn3, MATE_SCORE_BASE - 5, 1)).toBe('Mate in 5');
        expect(describePvStanding(mateIn3, mateIn3, 1)).toBe('Equal');
        expect(describePvStanding(150, -(MATE_SCORE_BASE - 4), 2)).toBe('Gets mated');
    });
});
