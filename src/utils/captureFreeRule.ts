/**
 * Sixty moves without a capture, and why a won endgame reads level.
 *
 * `gameResultForPosition` deliberately never returns a draw: which repetition
 * and move-limit rules apply is the tournament's decision, and guessing would
 * put a wrong verdict on a real game. The engine has no such reticence.
 * Pikafish adjudicates the limit itself -- `rule60 >= 120` in `position.cpp`,
 * subject to mate and prior repetition rulings -- and, less visibly, `evaluate.cpp` shades every evaluation
 * towards level on the way there:
 *
 *     v -= (v * pos.rule60_count()) / 253;
 *
 * So the number on the eval bar starts drifting from the first capture-free
 * move and reaches roughly half its true value by the limit. A player grinding
 * a rook-and-soldier ending watches +3.00 become +1.60 with nothing taken and
 * no piece moved to explain it, and the app said nothing at all.
 *
 * This module says it. It reports the count and what the engine will do with
 * it; it does not end the game, for the same reason the repetition notice does
 * not. `docs/architecture.md` records this as a reporting gap and says the
 * clock is already on the board's FEN, including its extended-check adjustment,
 * which is where the count comes from --
 * there is no second copy to fall out of step.
 */

/** `position.cpp`: `if (st->rule60 >= 120)` is a draw, in plies. */
export const CAPTURE_FREE_DRAW_PLIES = 120;

/**
 * Where the notice starts.
 *
 * Half the budget. Thirty moves with nothing taken is already an ending rather
 * than a middlegame, the evaluation is discounted by about a quarter by then,
 * and a player who has not noticed has time to do something about it. Saying
 * it from the first capture-free move would be noise on every opening.
 */
export const CAPTURE_FREE_REPORT_PLIES = 60;

export interface CaptureFreeReport {
    /** Counted plies since the last capture, discounting extended checking sequences. */
    plies: number;
    /** The same in full moves, which is the unit the rule is named for. */
    moves: number;
    /** Additional counted full moves before the limit; extended checks can delay it. */
    movesLeft: number;
    /** Whether the counter reached the limit; mate/repetition rulings can take precedence. */
    reached: boolean;
}

/** The fifth field of a FEN, or null when it is missing or not a count. */
export function readCaptureFreePlies(fen: string | null | undefined): number | null {
    if (typeof fen !== 'string') return null;
    const field = fen.trim().split(/\s+/)[4];
    if (!field || !/^\d+$/.test(field)) return null;
    const plies = Number(field);
    return Number.isFinite(plies) ? plies : null;
}

export function describeCaptureFree(plies: number | null): CaptureFreeReport | null {
    if (plies === null || !Number.isFinite(plies) || plies < CAPTURE_FREE_REPORT_PLIES) return null;
    const bounded = Math.trunc(plies);
    return {
        plies: bounded,
        moves: Math.floor(bounded / 2),
        movesLeft: Math.max(0, Math.ceil((CAPTURE_FREE_DRAW_PLIES - bounded) / 2)),
        reached: bounded >= CAPTURE_FREE_DRAW_PLIES,
    };
}

export function formatCaptureFreeHeadline(report: CaptureFreeReport): string {
    return `${report.moves} counted moves without a capture`;
}

export function formatCaptureFreeRule(report: CaptureFreeReport): string {
    if (report.reached) {
        return 'The 60-move counter has reached its limit. The engine can score a draw here; ' +
            'mate and repetition rulings take precedence. ' +
            'Play is not stopped here: which ruleset applies is the tournament\'s to decide.';
    }
    const remaining = report.movesLeft === 1 ? '1 move left' : `${report.movesLeft} moves left`;
    return `The engine can draw at 60 counted moves and shades its evaluation towards level ` +
        `as the counter rises. ${remaining}. Extended checking sequences can delay the limit.`;
}
