/**
 * The line the engine would have played, kept with the move it would have
 * replaced.
 *
 * A review already says *what* the better move was -- "Try C2+7" -- and that is
 * the half a player can act on. The half it left out is why: what follows, and
 * what the move was preparing. A reader who wants that has to leave the review,
 * step back one ply, and wait for a fresh search of a position the review has
 * already searched, at a depth it may not reach again.
 *
 * The engine gave the line away for free. `bestmove` arrives with the principal
 * variation that produced it, and that PV starts with the best move itself --
 * so keeping it costs one field and no extra search.
 *
 * Bounded, because it is stored per move and a review of a long game stores one
 * for every critical moment. Twelve plies is six moves a side, which is past
 * the point where a reader is following the line rather than reading it, and
 * past where a bounded search's tail is worth trusting.
 */
export const MAX_BEST_LINE_PLIES = 12;

const UCI_MOVE = /^[a-i][0-9][a-i][0-9]$/i;

/**
 * The line as it is stored: lower case, bounded, and only actual moves.
 *
 * Returns undefined rather than an empty array for a line with nothing in it,
 * so "no line" is one state and not two -- the same rule the notes and the
 * review's own optional fields follow.
 *
 * Read on the way out of storage as well as in. A saved review is written by
 * one build and read by the next, and this is the field most likely to be
 * absent from an older one.
 */
export function normalizeBestLine(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const moves: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') break;
        const move = entry.trim().toLowerCase();
        if (!UCI_MOVE.test(move)) break;
        moves.push(move);
        if (moves.length >= MAX_BEST_LINE_PLIES) break;
    }
    return moves.length > 0 ? moves : undefined;
}

/**
 * The stored line for a move the engine preferred, or undefined when the two
 * disagree about what the better move was.
 *
 * The PV comes from the search of the *parent* position, so its first move is
 * the engine's choice there. If that is not the `bestMove` the review recorded,
 * the two came from different searches and pairing them would put one search's
 * continuation under another's recommendation.
 */
export function bestLineForMove(bestMove: string | undefined, line: unknown): string[] | undefined {
    const normalized = normalizeBestLine(line);
    if (!normalized || !bestMove) return undefined;
    return normalized[0] === bestMove.trim().toLowerCase() ? normalized : undefined;
}

/**
 * Whether a line says anything the "Try C2+7" above it has not already said.
 *
 * A one-move line is the best move and nothing else, and printing it twice on
 * two adjacent lines is what the review note itself was changed to stop doing.
 */
export function isBestLineWorthShowing(line: string[] | undefined): line is string[] {
    return Array.isArray(line) && line.length > 1;
}
