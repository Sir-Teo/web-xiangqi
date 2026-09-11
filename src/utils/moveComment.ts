import { truncateText } from './truncateText';

/**
 * A note a person writes on a move.
 *
 * Every serious analysis board has this and this one did not: the only text
 * attached to a move was `reviewNote`, which the review writes and a person
 * cannot. So a study built here -- a repertoire line, an endgame technique, the
 * reason a natural move loses -- carried the moves and none of the thinking.
 *
 * Kept apart from `reviewNote` rather than sharing a field. The review
 * overwrites its own note on every re-run, and a person's note surviving that
 * is the whole point; the two also read differently, one being the engine's
 * verdict and the other the reader's.
 */

/**
 * Long enough for a paragraph of reasoning, short enough that a study of a
 * hundred moves still fits the share link's 8000-character tree budget with
 * room for the moves. Applied on the way in *and* on the way back out of
 * storage, which is the ceiling-before-parsing rule the rest of this app's
 * readers follow.
 */
export const MAX_MOVE_COMMENT_LENGTH = 500;

/**
 * What a comment becomes before anything stores or draws it.
 *
 * Newlines and control characters are folded to spaces. A comment travels
 * through a PGN `{ ... }` and a base64 URL parameter, and neither survives a
 * line break intact -- a multi-line comment exported and re-imported came back
 * as several broken ones. Folding here means what is stored is what every
 * surface can carry, rather than something that reads correctly until it is
 * shared.
 *
 * Braces go too, for the same reason and more sharply: `}` ends a PGN comment,
 * so one typed in the middle of a note would truncate it and leave the rest of
 * the note as illegal move text.
 *
 * Returns undefined for a comment that is empty once trimmed, so "cleared" and
 * "never written" are the same state and neither is stored.
 */
export function normalizeMoveComment(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const folded = value
        .replace(/[{}]/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!folded) return undefined;
    return truncateText(folded, MAX_MOVE_COMMENT_LENGTH);
}

/** Whether an edit changes what is stored, so an unchanged edit writes nothing. */
export function isSameMoveComment(current: string | undefined, next: string | undefined): boolean {
    return (current ?? '') === (next ?? '');
}

/**
 * The comment as a move list row shows it: one line, cut at a word where it
 * can be. The full text is on the title and in the editor.
 */
export function summarizeMoveComment(comment: string, maxLength = 48): string {
    const normalized = normalizeMoveComment(comment) ?? '';
    if (normalized.length <= maxLength) return normalized;
    const cut = truncateText(normalized, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
