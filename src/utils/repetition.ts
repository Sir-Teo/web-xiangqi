import { boardToFen, type BoardState, type Side } from './xiangqi';

/**
 * Repeated positions, and what xiangqi does about them.
 *
 * This is the rule that separates xiangqi from chess, and the app had none of
 * it. `gameResultForPosition` says so in a comment -- "repetition adjudication
 * depends on perpetual check/chase patterns, so a repeated board position
 * alone is not enough to end the game" -- and then returns null, so a player
 * shuffling a chariot back and forth saw nothing at all. In chess that is a
 * draw. In xiangqi, whether it is a draw, a win or a loss depends entirely on
 * *what the repeating moves were doing*, and the player who is checking has to
 * be the one to break off.
 *
 * The World Xiangqi Federation rules, in the part that is unambiguous:
 *
 * - **Perpetual check loses.** A side that will not stop checking is ruled to
 *   have lost, whether the checks come from one piece or several.
 * - **Perpetual chase of an unprotected piece loses**, generals and soldiers
 *   excepted as chasers.
 * - **One of each is a loss for the checker.** If one side checks perpetually
 *   and the other chases perpetually, the checking side has to stop or lose.
 * - **Neither, and it is a draw.** Two sides repeating without either of them
 *   forcing it is drawn.
 *
 * ## What this module does and does not decide
 *
 * It reports the repetition and classifies the *cycle*: who, if anyone, was
 * checking every time round. That covers perpetual check, which is both the
 * common case and the one that can be read straight off the move records --
 * each one already stores whether the move it describes left the opponent in
 * check.
 *
 * It deliberately does not adjudicate chases. Deciding 長捉 needs to know which
 * piece is being chased, whether it is protected, and whether the chaser is
 * threatening it or merely standing near it -- and the rulebook carves out
 * cases for pinned pieces, for a chased piece that is itself checking, and for
 * chasing with a general or a soldier. Guessing at that would be worse than
 * saying nothing, because it would put a wrong verdict on a real game. So an
 * unclassified cycle reports `unforced`, and the wording tells the player it
 * is a draw *unless a chase is involved* rather than claiming it is drawn.
 *
 * Nothing here ends a game on its own. It describes the position so the board
 * can say what the rules require, which is what a player needs and what the
 * repo did not have.
 */

/** Threefold is where tournament practice starts calling a cycle perpetual. */
export const REPETITION_REPORT_THRESHOLD = 3;

export type RepetitionVerdict =
    /** Neither side forced the cycle: drawn, absent a chase this cannot see. */
    | 'unforced'
    /** Red checked on every visit: Red must vary or be ruled to have lost. */
    | 'red-perpetual-check'
    /** Black checked on every visit: Black must vary or be ruled to have lost. */
    | 'black-perpetual-check'
    /** Both sides checked throughout, which the rules leave as a draw. */
    | 'mutual-perpetual-check';

export interface RepetitionReport {
    /** How many times the current position has stood in this line, itself included. */
    occurrences: number;
    verdict: RepetitionVerdict;
    /** The side that has to change its move, or null when neither does. */
    mustVary: Side | null;
}

/** One ply of the line, in the order it was played. */
export interface RepetitionPly {
    board: BoardState;
    /** Whose turn it is *after* this move. */
    sideToMove: Side;
    /** Whether this move left the opponent in check. */
    inCheck: boolean;
}

/**
 * Identity for repetition purposes: the pieces and whose turn it is.
 *
 * Move counters are excluded on purpose -- they differ on every visit, which
 * would make every position unique and the whole check vacuous.
 */
export function positionKey(board: BoardState, sideToMove: Side): string {
    return boardToFen(board, sideToMove, 1).split(' ').slice(0, 2).join(' ');
}

function verdictFor(redCheckedThroughout: boolean, blackCheckedThroughout: boolean): RepetitionVerdict {
    if (redCheckedThroughout && blackCheckedThroughout) return 'mutual-perpetual-check';
    if (redCheckedThroughout) return 'red-perpetual-check';
    if (blackCheckedThroughout) return 'black-perpetual-check';
    return 'unforced';
}

/**
 * Look at the position after `line`, and at how the line got back to it.
 *
 * The cycle examined is everything since the *previous* visit to this same
 * position. A side counts as checking perpetually when every move it made
 * inside that cycle gave check -- one quiet move in the loop and it is not
 * perpetual, which is exactly the out the rules give a player: vary once.
 */
export function describeRepetition(
    rootBoard: BoardState,
    rootSideToMove: Side,
    line: RepetitionPly[]
): RepetitionReport {
    const currentBoard = line.length ? line[line.length - 1].board : rootBoard;
    const currentSide = line.length ? line[line.length - 1].sideToMove : rootSideToMove;
    const currentKey = positionKey(currentBoard, currentSide);

    // Index -1 stands for the root, so a cycle back to the starting position is
    // measured like any other.
    const visits: number[] = [];
    if (positionKey(rootBoard, rootSideToMove) === currentKey) visits.push(-1);
    line.forEach((ply, index) => {
        if (positionKey(ply.board, ply.sideToMove) === currentKey) visits.push(index);
    });

    const occurrences = visits.length;
    if (occurrences < 2) {
        return { occurrences: Math.max(1, occurrences), verdict: 'unforced', mustVary: null };
    }

    const previousVisit = visits[visits.length - 2];
    const cycle = line.slice(previousVisit + 1);

    let redMoves = 0;
    let blackMoves = 0;
    let redChecks = 0;
    let blackChecks = 0;
    for (const ply of cycle) {
        // `sideToMove` is whose turn it is after the move, so the mover is the
        // other one.
        const mover: Side = ply.sideToMove === 'w' ? 'b' : 'w';
        if (mover === 'w') {
            redMoves += 1;
            if (ply.inCheck) redChecks += 1;
        } else {
            blackMoves += 1;
            if (ply.inCheck) blackChecks += 1;
        }
    }

    const redCheckedThroughout = redMoves > 0 && redChecks === redMoves;
    const blackCheckedThroughout = blackMoves > 0 && blackChecks === blackMoves;
    const verdict = verdictFor(redCheckedThroughout, blackCheckedThroughout);

    return {
        occurrences,
        verdict,
        mustVary: verdict === 'red-perpetual-check' ? 'w' : verdict === 'black-perpetual-check' ? 'b' : null,
    };
}

/** Whether this repetition is worth putting on screen. */
export function shouldReportRepetition(report: RepetitionReport): boolean {
    // A perpetual check is worth saying the moment it is established, because
    // the player it binds needs to know before they repeat it into a loss.
    if (report.verdict !== 'unforced') return report.occurrences >= 2;
    return report.occurrences >= REPETITION_REPORT_THRESHOLD;
}

export function formatRepetitionHeadline(report: RepetitionReport): string {
    switch (report.verdict) {
        case 'red-perpetual-check':
            return 'Red is checking perpetually';
        case 'black-perpetual-check':
            return 'Black is checking perpetually';
        case 'mutual-perpetual-check':
            return 'Both sides are checking perpetually';
        default:
            return `Position repeated ${report.occurrences} times`;
    }
}

export function formatRepetitionRule(report: RepetitionReport): string {
    switch (report.verdict) {
        case 'red-perpetual-check':
            return 'Xiangqi rules a perpetual check a loss for the checking side. Red has to vary.';
        case 'black-perpetual-check':
            return 'Xiangqi rules a perpetual check a loss for the checking side. Black has to vary.';
        case 'mutual-perpetual-check':
            return 'Both sides are forcing the repetition, which the rules leave as a draw.';
        default:
            return 'Neither side is checking, so this is a draw unless one side is perpetually chasing.';
    }
}
