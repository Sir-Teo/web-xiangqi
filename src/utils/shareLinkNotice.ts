import { formatMoveRuleHint } from './moveRuleHints';

/**
 * Why a shared link did not load, in words the person who opened it can act on.
 *
 * The import box already does this: paste a record it can only read partway and
 * it says how many moves arrived and which one stopped it. A share link said
 * "Shared link not loaded" for every one of five different failures, and put
 * the reason in a `console.warn` -- so the recipient, who did not write the
 * link and cannot see the sender's console, was told that something was wrong
 * and nothing else.
 *
 * The five are worth separating because they need different things done about
 * them: a truncated URL is the messaging app's fault and re-sending may fix it,
 * an illegal move means the two sides disagree about the position, and a link
 * that is simply too long was never going to work.
 *
 * The headline is unchanged, because it is the right headline and because it is
 * what the browser suite waits on. This is the sentence under it.
 */
export type ShareLinkFailure =
    /** More text than the importer will read at all. */
    | { kind: 'too-long' }
    /** Inside the text ceiling, past the move ceiling. */
    | { kind: 'too-many-moves' }
    /** A token in the move list is not a move. */
    | { kind: 'unreadable-move'; token?: string }
    /**
     * The `fen` parameter does not describe a position a game could reach.
     * `reason` is `describeFenProblem`'s sentence, which tells the recipient
     * whether the link arrived damaged or the sender built something illegal
     * -- two problems with different answers, and the same notice otherwise.
     */
    | { kind: 'bad-start-position'; reason?: string }
    /** The moves are readable and one of them cannot be played. */
    | { kind: 'illegal-move'; moveNumber: number; reason?: string }
    /** The main line loaded; the variations did not. */
    | { kind: 'variations' }
    /** The link carried variations and nothing else, and they could not be used. */
    | { kind: 'variations-only' };

export const SHARE_LINK_FAILED_HEADLINE = 'Shared link not loaded';
export const SHARE_VARIATIONS_FAILED_HEADLINE = 'Shared variations not loaded';

export function shareLinkHeadline(failure: ShareLinkFailure): string {
    return failure.kind === 'variations' ? SHARE_VARIATIONS_FAILED_HEADLINE : SHARE_LINK_FAILED_HEADLINE;
}

/** The ply a move sits on, as a reader counts moves: 1... for red, 1... for black. */
function moveOrdinal(moveNumber: number): string {
    const ply = Math.max(1, Math.trunc(moveNumber));
    const fullMove = Math.ceil(ply / 2);
    return ply % 2 === 1 ? `move ${fullMove} for Red` : `move ${fullMove} for Black`;
}

export function describeShareLinkFailure(failure: ShareLinkFailure): string {
    switch (failure.kind) {
        case 'too-long':
            return 'The link carries more moves than this app will read. Nothing was loaded.';
        case 'too-many-moves':
            return 'The link carries more moves than one game can hold. Nothing was loaded.';
        case 'unreadable-move':
            return failure.token
                ? `The move list reads "${failure.token}", which is not a move. A link cut short in transit looks like this — ask for it again.`
                : 'The move list contains something that is not a move. A link cut short in transit looks like this — ask for it again.';
        case 'bad-start-position':
            return failure.reason
                ? `The starting position in the link is not one a game could reach. ${failure.reason}`
                : 'The starting position in the link is not one a game could reach.';
        case 'illegal-move':
            return `The moves stop being playable at ${moveOrdinal(failure.moveNumber)}. ` +
                `${formatMoveRuleHint(failure.reason)}`;
        case 'variations':
            return 'The main line loaded. The variations in the link did not match it, so they were left out.';
        case 'variations-only':
            return 'The link carried variations and no main line, and they could not be read. A link cut short in transit looks like this — ask for it again.';
    }
}
