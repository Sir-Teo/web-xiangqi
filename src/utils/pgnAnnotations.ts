import { recordedResultPgn, type RecordedResult } from './recordedResult';
import { studyAnalysisPgn, type StudyAnalysis } from './studyAnalysis';
import { mateDistanceFromScore, type EvaluationScoreKind } from './engineEvalReading';
import type { ReviewMoveQuality } from './review';
import { normalizeMoveComment } from './moveComment';
import { normalizeEvalDepth } from './moveEvaluation';

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
    recordedResult?: RecordedResult;
    /** Evaluation after the move, red-positive centipawns, as the engine gave it. */
    evalScore?: number;
    evalDepth?: number;
    evalScoreKind?: EvaluationScoreKind;
    quality?: ReviewMoveQuality;
    /** The engine's preference in the position this move was played in. */
    bestMove?: string;
    /** The move actually played, so a redundant "better was" can be dropped. */
    uci?: string;
    /** The reader's own note, which is the last thing in the comment. */
    comment?: string;
    analysis?: StudyAnalysis;
}

/**
 * The evaluation as `[%eval ...]` writes it: pawns to two places, or `#N` for a
 * mate, counted in moves and signed for the side delivering it.
 */
export function formatEvalCommand(evalScore: number, evalDepth?: number, evalScoreKind?: EvaluationScoreKind): string | null {
    if (!Number.isFinite(evalScore)) return null;
    const depth = normalizeEvalDepth(evalDepth);
    const suffix = depth === undefined ? '' : `,${depth}`;
    const mateDistance = mateDistanceFromScore(evalScore, evalScoreKind);
    if (mateDistance !== null) {
        // The sign comes from the score, not from the distance. A mate in zero
        // -- the position after this move is already mate -- gives a distance
        // of -0 for black, and `${-0}` is "0", so black's mate wrote as `#0`
        // and read back as red's. Found by sweeping generated games through
        // the exporter and the importer.
        const sign = evalScore < 0 ? '-' : '';
        return `[%eval #${sign}${Math.abs(mateDistance)}${suffix}]`;
    }
    return `[%eval ${(evalScore / 100).toFixed(2)}${suffix}]`;
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
    const result = recordedResultPgn(input.recordedResult);
    if (result) comment.push(result);
    const analysis = studyAnalysisPgn(input.analysis);
    if (analysis) comment.push(analysis);
    if (typeof input.evalScore === 'number') {
        const command = formatEvalCommand(input.evalScore, input.evalDepth, input.evalScoreKind);
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

    // The reader's note goes last, after the machine-readable parts, which is
    // where every tool that writes both puts it and where the importer looks
    // for it. `normalizeMoveComment` has already taken the braces out; without
    // that a `}` typed in a note would end the comment and leave the rest of
    // the sentence in the move stream.
    const note = normalizeMoveComment(input.comment);
    if (note) comment.push(note);

    if (comment.length) tokens.push(`{ ${comment.join(' ')} }`);
    return tokens;
}

/** Whether anything in this game is worth annotating. */
export function hasAnythingToAnnotate(moves: MoveAnnotationInput[]): boolean {
    return moves.some((move) => annotationTokensForMove(move).length > 0);
}
