import type { PvLine } from '../hooks/useEngine';
import { parseMateScoreText } from './engineScore';

type Reading = Pick<PvLine, 'score' | 'scoreStr' | 'bounded'>;

/** Below a twentieth of a pawn, a numeric gap rounds to an unhelpful 0.0. */
export const PV_STANDING_EQUAL_THRESHOLD_CP = 5;

/**
 * Compare readings from the same side to move. The UCI score kind survives in
 * scoreStr; inferring it from a numeric range mistakes large cp values for mate.
 * A losing mate in zero has distance -0, whose sign a plain `< 0` test loses.
 */
export function describePvStanding(best: Reading, line: Reading, lineIndex: number): string {
    if (lineIndex === 0) return line.bounded ? 'Not exact' : 'Best';
    if (best.bounded || line.bounded) return 'Not exact';
    const bestMate = parseMateScoreText(best.scoreStr);
    const lineMate = parseMateScoreText(line.scoreStr);
    if (lineMate !== null) {
        if (lineMate < 0 || Object.is(lineMate, -0)) return 'Gets mated';
        if (bestMate !== null && Object.is(bestMate, lineMate)) return 'Equal';
        return `Mate in ${lineMate}`;
    }
    if (bestMate !== null) {
        // A numeric difference against a mate sentinel has no pawn meaning.
        return 'No mate shown';
    }
    const gap = best.score - line.score;
    if (Math.abs(gap) < PV_STANDING_EQUAL_THRESHOLD_CP) return 'Equal';
    return `${(Math.abs(gap) / 100).toFixed(1)} ${gap < 0 ? 'ahead' : 'behind'}`;
}
