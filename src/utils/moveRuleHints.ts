/**
 * The sentence a player sees when a move is refused.
 *
 * `validatePieceMove` returns a `reason` written for the code that reads it --
 * "rook moves orthogonally", "pawn move is illegal" -- and those are the wrong
 * words to put in front of someone learning the game. There is no rook in
 * xiangqi, and "illegal" does not say what would have been legal.
 *
 * Lifted out of `App.tsx` on the rule the invariants set: new pure logic lives
 * in `utils/` with a colocated test, and the moment to move an old helper is
 * when you are about to edit it. This was one of the three that note names.
 *
 * A record rather than a `switch`, so that "is this reason handled?" is a fact
 * the test can read. The test holds no list of reasons: it drives the rules
 * engine until it has *seen* every reason the engine produces, then asserts
 * each is a key here. A `switch` cannot be asked that, and a hand-written list
 * would pass forever after someone added the twenty-fifth reason.
 */
export const MOVE_RULE_HINTS: Record<string, string> = {
    'horse leg blocked':
        'Horse leg is blocked.',
    'elephant eye blocked':
        'Elephant eye is blocked.',
    'cannon capture needs one screen':
        'Cannon captures need exactly one screen.',
    'cannon moves orthogonally':
        'Cannon moves in straight lines.',
    'cannon path blocked':
        'Cannon path is blocked.',
    'rook moves orthogonally':
        'Chariot moves in straight lines.',
    'rook path blocked':
        'Chariot path is blocked.',
    'horse moves in an L':
        'Horse moves one point straight, then one point diagonal.',
    'advisor moves 1 diagonally':
        'Advisor moves one point diagonally inside the palace.',
    'advisor must stay in palace':
        'Advisor must stay inside the palace.',
    'general moves 1 orthogonally':
        'General moves one point orthogonally inside the palace.',
    'general must stay in palace':
        'General must stay inside the palace.',
    'generals cannot face each other':
        'Generals cannot face each other.',
    'move must change square':
        'Choose a different destination square.',
    'move leaves general in check':
        'That leaves your general in check.',
    'elephant moves 2 diagonally':
        'Elephant moves two points diagonally.',
    'elephant cannot cross river':
        'Elephant cannot cross the river.',
    'pawn move is illegal':
        'Soldiers move forward, then sideways after crossing the river.',
    'not your piece':
        'Move the side whose turn it is.',
    'cannot capture your own piece':
        'Choose an empty square or an opposing piece.',
    'out of bounds':
        'That square is off the board.',
    'no piece on source square':
        'There is no piece on that square.',
    'invalid move format':
        'That move could not be read.',
};

export const UNKNOWN_MOVE_RULE_HINT = 'That move is not legal in this position.';

export function formatMoveRuleHint(reason?: string): string {
    if (!reason) return UNKNOWN_MOVE_RULE_HINT;
    const hint = MOVE_RULE_HINTS[reason];
    if (hint) return hint;
    // A reason with no sentence reaches the player as the engine's own words.
    // The test beside this file exists to make sure that never happens for a
    // reason the engine can actually produce.
    return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}
