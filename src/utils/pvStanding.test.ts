import { describe, expect, it } from 'vitest';
import { MATE_SCORE_BASE } from './engineEvalReading';
import { describePvStanding } from './pvStanding';

const cp = (score: number, bounded = false) => ({ score, scoreStr: String(score), bounded });
const mate = (distance: number) => ({
    score: distance < 0 || Object.is(distance, -0) ? -MATE_SCORE_BASE - distance : MATE_SCORE_BASE - distance,
    scoreStr: `${distance < 0 || Object.is(distance, -0) ? '-' : '+'}M${Math.abs(distance)}`,
});

describe('describePvStanding', () => {
    it('names the first line best whatever its score', () => {
        expect(describePvStanding(cp(30), cp(30), 0)).toBe('Best');
        expect(describePvStanding(mate(2), mate(2), 0)).toBe('Best');
    });

    it('calls a nearly level line equal instead of printing 0.0 behind', () => {
        expect(describePvStanding(cp(30), cp(30), 1)).toBe('Equal');
        expect(describePvStanding(cp(30), cp(27), 1)).toBe('Equal');
        expect(describePvStanding(cp(30), cp(33), 1)).toBe('Equal');
    });

    it('prints a meaningful gap in pawns', () => {
        expect(describePvStanding(cp(30), cp(25), 1)).toBe('0.1 behind');
        expect(describePvStanding(cp(120), cp(-40), 2)).toBe('1.6 behind');
    });

    it('does not call a higher secondary reading equal while PV slots update', () => {
        expect(describePvStanding(cp(30), cp(60), 1)).toBe('0.3 ahead');
    });

    it('does not mistake large cp readings for mate', () => {
        expect(describePvStanding(cp(29999), cp(29950), 1)).toBe('0.5 behind');
        expect(describePvStanding(cp(-15000), cp(-30000), 1)).toBe('150.0 behind');
        expect(describePvStanding(mate(3), cp(29950), 1)).toBe('No mate shown');
        expect(describePvStanding(cp(29999), mate(5), 1)).toBe('Mate in 5');
    });

    it('reads mate as a kind of answer, not as hundreds of pawns', () => {
        expect(describePvStanding(mate(3), cp(150), 1)).toBe('No mate shown');
        expect(describePvStanding(mate(-3), cp(-500), 1)).toBe('No mate shown');
        expect(describePvStanding(mate(3), mate(5), 1)).toBe('Mate in 5');
        expect(describePvStanding(mate(3), mate(3), 1)).toBe('Equal');
        expect(describePvStanding(cp(150), mate(-4), 2)).toBe('Gets mated');
    });

    it('preserves which side loses even for mate zero', () => {
        expect(describePvStanding(cp(150), mate(-0), 1)).toBe('Gets mated');
        expect(describePvStanding(cp(150), mate(0), 1)).toBe('Mate in 0');
        expect(describePvStanding(mate(0), cp(150), 1)).toBe('No mate shown');
        expect(describePvStanding(mate(0), mate(0), 1)).toBe('Equal');
    });

    it('does not turn a bound into an exact gap or equality', () => {
        expect(describePvStanding(cp(100, true), cp(100), 1)).toBe('Not exact');
        expect(describePvStanding(cp(100), cp(50, true), 1)).toBe('Not exact');
        expect(describePvStanding(mate(3), { ...mate(4), bounded: true }, 1)).toBe('Not exact');
    });
});
