/**
 * How a mate is encoded once it leaves the engine.
 *
 * UCI reports `score mate N`, which is a statement about *moves*, not about
 * material. `useEngine` folds it into the same centipawn field everything else
 * reads, as `MATE_SCORE_BASE - N`, so anything that wants to know a score is a
 * mate rather than an evaluation compares against this.
 *
 * It lives here rather than in `useEngine` because it is now read in two
 * places -- the hook that writes it and the PGN export that decodes it back
 * into `#N` -- and a threshold written down twice is a threshold that drifts.
 */
export const MATE_SCORE_BASE = 30000;

/**
 * Mate distance in moves for a sentinel score, or null for an ordinary one.
 *
 * Positive is mate for red, negative mate for black, matching the sign of the
 * score itself.
 */
export function mateDistanceFromScore(score: number): number | null {
    if (!Number.isFinite(score)) return null;
    const distance = MATE_SCORE_BASE - Math.abs(score);
    if (distance < 0 || distance > MATE_SCORE_BASE / 2) return null;
    return score >= 0 ? distance : -distance;
}

/**
 * The evaluation the app is holding for the search now running, and whether it
 * came from an exact score or a bound.
 *
 * `score cp 150 lowerbound` means "at least 150", not "150". Both flags fall
 * out of an aspiration-window re-search and the exact line normally follows a
 * moment later, so a bound is worth showing while nothing exact has arrived and
 * must never displace one that has. `shouldReplacePvLine` applies the same rule
 * to the PV slots; this is the same rule for the single number on the eval bar.
 *
 * The reading and the flag live in one value because they have to be discarded
 * together. They were two refs in `useEngine`, and starting a search cleared the
 * number without clearing the flag -- so the exactness of the *previous* search
 * survived into the next one and rejected its opening bounds. The eval then sat
 * at 0.00 until an exact score arrived, which on a sharp position is several
 * seconds of aspiration re-searches. One value cannot be half-reset.
 */
export interface EvalReading {
    /** The evaluation to show, or null when this search has said nothing yet. */
    score: number | null;
    /** Whether `score` came from an exact reading rather than a bound. */
    exact: boolean;
}

export function emptyEvalReading(): EvalReading {
    return { score: null, exact: false };
}

/**
 * Fold one `score cp`/`score mate` reading into what is already held.
 *
 * Returns the same object when nothing changes, so a caller can skip work on
 * the bounds that arrive while an exact score is already in hand.
 */
export function takeEvalReading(current: EvalReading, score: number, isBounded: boolean): EvalReading {
    if (isBounded && current.exact) return current;
    if (current.score === score && current.exact === !isBounded) return current;
    return { score, exact: !isBounded };
}
