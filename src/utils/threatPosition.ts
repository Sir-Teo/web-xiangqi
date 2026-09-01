import { isInCheck, kingsFacing, parseFenBoard, type Side } from './xiangqi';

/**
 * The same position with the other side to move — a "null move".
 *
 * This is how you ask an engine the question every player actually has, and
 * which no amount of staring at the best move answers: *what are they
 * threatening?* Give the opponent the move and the engine's reply is the
 * threat. Lichess calls it Show Threat; it is the one analysis feature that
 * serves a beginner ("why is this losing?") and a professional ("what am I
 * being asked to stop?") with the same output.
 *
 * ## Why it can be refused
 *
 * Passing is not always a position. The side that passes becomes the side *not*
 * to move, and a side not to move may not be under attack — the opponent would
 * simply capture the general and there would be no game left to evaluate. So a
 * pass is only offered when the side to move is not in check, which is also
 * when the question is interesting: a player in check is not being threatened
 * with something, they are being hit with it.
 *
 * Facing generals are the same rule arriving by another route. `attacksSquare`
 * treats a general as attacking down an open file, so generals on one file with
 * nothing between them means both are in check and the pass is already refused.
 * The explicit test is kept because it costs nothing and because a caller
 * reading this should not have to know that the flying-general rule is folded
 * into `isInCheck`.
 *
 * ## What is deliberately left alone
 *
 * **The halfmove clock does not advance.** It is load-bearing — Pikafish
 * adjudicates the natural limit from it, and the same endgame reads mate in 3
 * at 0 and 0.00 at 119 — so moving it would evaluate the threat at a different
 * point of the game from the position it is about. Nothing has progressed; a
 * pass is a question, not a ply.
 *
 * **The fullmove counter does advance when Black passes**, because that field
 * counts Red's turns and the next one is Red's. It reaches nothing but the
 * display of a position no one navigates to, and getting it wrong would be a
 * FEN that does not describe itself.
 *
 * The caller must send this as a bare `position fen`, not as the root plus the
 * game's moves: there is no move that reaches it. That costs the engine its
 * repetition history for this one search, which is the honest price of asking
 * a question about a position the game cannot arrive at.
 */
export function passMoveFen(fen: string): string | null {
    const parts = String(fen ?? '').trim().split(/\s+/);
    if (parts.length < 2) return null;

    const sideToMove: Side = parts[1] === 'b' ? 'b' : 'w';
    if (parts[1] !== 'w' && parts[1] !== 'b') return null;

    let board;
    try {
        board = parseFenBoard(parts[0]);
    } catch {
        return null;
    }

    // The side that passes stops being the side to move, and a side not to move
    // may not be in check.
    if (kingsFacing(board)) return null;
    if (isInCheck(board, sideToMove)) return null;

    const passed: Side = sideToMove === 'w' ? 'b' : 'w';
    const halfmove = parts[4] ?? '0';
    const parsedFullmove = Number(parts[5]);
    const fullmove = Number.isFinite(parsedFullmove) && parsedFullmove > 0
        ? Math.trunc(parsedFullmove)
        : 1;
    // Black passing hands the move to Red, which is a new full move.
    const nextFullmove = sideToMove === 'b' ? fullmove + 1 : fullmove;

    return `${parts[0]} ${passed} ${parts[2] ?? '-'} ${parts[3] ?? '-'} ${halfmove} ${nextFullmove}`;
}
