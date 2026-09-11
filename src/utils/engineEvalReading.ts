/** Legacy numeric mate encoding, retained for existing saved games. */
export const MATE_SCORE_BASE = 30000;
export type EvaluationScoreKind = 'cp' | 'mate';

/**
 * Preserve an explicit centipawn reading in the legacy mate range. Other
 * readings already decode unambiguously and need no extra storage field.
 * An old record with no override retains its original interpretation.
 */
export function evaluationKindOverride(score: number, kind: unknown): EvaluationScoreKind | undefined {
    return kind === 'cp' && mateDistanceFromScore(score) !== null ? 'cp' : undefined;
}

/**
 * Mate distance in moves for a sentinel score, or null for an ordinary one.
 *
 * Positive is mate for red, negative mate for black, matching the sign of the
 * score itself.
 */
export function mateDistanceFromScore(score: number, kind?: EvaluationScoreKind): number | null {
    if (!Number.isFinite(score) || kind === 'cp') return null;
    const distance = MATE_SCORE_BASE - Math.abs(score);
    if (distance < 0 || distance > MATE_SCORE_BASE / 2) return null;
    return score >= 0 ? distance : -distance;
}

/** Compare finite, Red-positive readings: losing mate < cp < winning mate. */
export function compareEvaluationScores(left: number, right: number, leftKind?: EvaluationScoreKind, rightKind?: EvaluationScoreKind): number {
    const leftClass = mateDistanceFromScore(left, leftKind) === null ? 0 : Math.sign(left);
    const rightClass = mateDistanceFromScore(right, rightKind) === null ? 0 : Math.sign(right);
    // Within either mate class, the legacy number already orders distances:
    // faster Red mates are higher; faster Black mates are lower, including M0.
    return leftClass - rightClass || Math.sign(left - right);
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
    kind?: EvaluationScoreKind;
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
export function takeEvalReading(current: EvalReading, score: number, isBounded: boolean, scoreKind?: EvaluationScoreKind): EvalReading {
    if (isBounded && current.exact) return current;
    const kind = evaluationKindOverride(score, scoreKind);
    if (current.score === score && current.exact === !isBounded && current.kind === kind) return current;
    return { score, exact: !isBounded, ...(kind ? { kind } : {}) };
}

/**
 * One evaluation in the words a reader uses: pawns to `decimals` places, or
 * `+M3` / `-M3` when the score is the mate sentinel above.
 *
 * `(score / 100).toFixed(2)` was written out five times across the graph, the
 * review panel and the library, and every one of them printed a mate as
 * `+299.85` -- three hundred pawns, because `MATE_SCORE_BASE - 15` divided by
 * a hundred is 299.85 and nothing along the way knew the number was a mate.
 * The eval bar and the candidate list had already been taught this (they read
 * `scoreStr`, which carries `+M15` from the engine); the surfaces that only
 * ever see a raw number had not, so the same position read `+M15` beside the
 * board and `+299.85` on the graph.
 *
 * Returns null for a non-finite score so each caller decides what a missing
 * reading looks like, the way `formatEvalCommand` does for PGN.
 *
 * The sign comes from the score rather than from the distance: a mate in zero
 * for black gives a distance of `-0`, and `${-0}` is `"0"`.
 */
export function formatEvaluationText(score: number, decimals = 2, kind?: EvaluationScoreKind): string | null {
    if (!Number.isFinite(score)) return null;
    const mateDistance = mateDistanceFromScore(score, kind);
    if (mateDistance !== null) {
        return `${score < 0 ? '-' : '+'}M${Math.abs(mateDistance)}`;
    }
    return `${score > 0 ? '+' : ''}${(score / 100).toFixed(decimals)}`;
}
