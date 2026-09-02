import { mateDistanceFromScore } from './engineEvalReading';

/**
 * How an engine line stands against the best one, in the words the candidate
 * list prints beside it.
 *
 * Both scores are raw, side-to-move relative, straight off the same search --
 * which is what makes them comparable at all. The gap used to be printed as
 * `${(best - line) / 100} behind` for every line after the first, and that
 * produced two readings a player had to stop and decode:
 *
 * - "0.0 behind" for a line the engine scores level with the best, which is
 *   most of an opening at MultiPV 3 and reads as a rounding artefact rather
 *   than as the useful fact that the two are interchangeable.
 * - "297.9 behind" when the best line mates, because a mate is stored as a
 *   sentinel near 30000 and the subtraction does not know that. A mate is not
 *   298 pawns better than a quiet move; it is a different kind of answer.
 *
 * Under a twentieth of a pawn is "Equal": the engine's own evaluations move
 * by more than that between two consecutive depths.
 */
export const PV_STANDING_EQUAL_THRESHOLD_CP = 5;

export function describePvStanding(bestScore: number, lineScore: number, lineIndex: number): string {
    if (lineIndex === 0) return 'Best';
    const bestMate = mateDistanceFromScore(bestScore);
    const lineMate = mateDistanceFromScore(lineScore);
    if (lineMate !== null) {
        if (lineMate < 0) return 'Gets mated';
        if (bestMate !== null && bestMate === lineMate) return 'Equal';
        return `Mate in ${lineMate}`;
    }
    if (bestMate !== null && bestMate > 0) return 'No mate';
    const gap = Math.max(0, bestScore - lineScore);
    if (gap < PV_STANDING_EQUAL_THRESHOLD_CP) return 'Equal';
    return `${(gap / 100).toFixed(1)} behind`;
}
