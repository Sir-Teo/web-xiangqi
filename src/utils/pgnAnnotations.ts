import { mateDistanceFromScore } from './engineEvalReading';
import type { ReviewMoveQuality } from './review';

/**
 * Writing the review into the PGN, so the analysis leaves with the game.
 *
 * A review is the expensive part of using this app and it was the part that
 * could not be taken anywhere: the export carried the moves and nothing else,
 * so an annotated game opened in another tool as a bare move list, and a game
 * exported and re-imported here lost every evaluation with it.
 *
 * Two conventions, both of which other tools already read:
 *
 * - **NAGs** for move quality. `$6`/`$2`/`$4` are the standard numeric
 *   annotation glyphs for `?!`, `?` and `??`, and a reader that knows nothing
 *   about this app still renders them as those symbols.
 * - **`{[%eval ...]}` comments** for the evaluation after the move, in pawns,
 *   red-positive. This is Lichess's shape, which ChessBase-family tools and
 *   most web boards parse; the bracketed command is designed to sit inside an
 *   ordinary PGN comment so a reader that does not know it treats the whole
 *   thing as prose rather than choking.
 *
 * Good and best moves get no glyph. That is the convention rather than an
 * omission: annotating every move is noise, and the thing a reader is looking
 * for is where the game went wrong.
 */

/** Standard PGN numeric annotation glyphs, for the qualities that get one. */
const NAG_FOR_QUALITY: Partial<Record<ReviewMoveQuality, string>> = {
    inaccuracy: '$6',
    mistake: '$2',
    blunder: '$4',
};

export interface MoveAnnotationInput {
    /** Evaluation after the move, red-positive centipawns, as the engine gave it. */
    evalScore?: number;
    quality?: ReviewMoveQuality;
    /** The engine's preference in the position this move was played in. */
    bestMove?: string;
    /** The move actually played, so a redundant "better was" can be dropped. */
    uci?: string;
}

/**
 * The evaluation as `[%eval ...]` writes it: pawns to two places, or `#N` for a
 * mate, counted in moves and signed for the side delivering it.
 */
export function formatEvalCommand(evalScore: number): string | null {
    if (!Number.isFinite(evalScore)) return null;
    const mateDistance = mateDistanceFromScore(evalScore);
    if (mateDistance !== null) return `[%eval #${mateDistance}]`;
    return `[%eval ${(evalScore / 100).toFixed(2)}]`;
}

/**
 * The tokens that follow one move: its glyph, then its comment.
 *
 * Returns an empty array when there is nothing to say, so a game with no review
 * exports exactly the PGN it exported before.
 */
export function annotationTokensForMove(input: MoveAnnotationInput): string[] {
    const tokens: string[] = [];

    const nag = input.quality ? NAG_FOR_QUALITY[input.quality] : undefined;
    if (nag) tokens.push(nag);

    const comment: string[] = [];
    if (typeof input.evalScore === 'number') {
        const command = formatEvalCommand(input.evalScore);
        if (command) comment.push(command);
    }
    // Only where it is the point. On a move already graded good there is
    // nothing to say, and on a blunder the alternative is the whole message.
    const worthNamingBest = input.quality === 'inaccuracy'
        || input.quality === 'mistake'
        || input.quality === 'blunder';
    if (worthNamingBest && input.bestMove && input.bestMove !== input.uci) {
        comment.push(`Better was ${input.bestMove}`);
    }

    if (comment.length) tokens.push(`{ ${comment.join(' ')} }`);
    return tokens;
}

/** Whether anything in this game is worth annotating. */
export function hasAnythingToAnnotate(moves: MoveAnnotationInput[]): boolean {
    return moves.some((move) => annotationTokensForMove(move).length > 0);
}
