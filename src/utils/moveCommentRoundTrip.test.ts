import { describe, expect, it } from 'vitest';
import { annotationTokensForMove } from './pgnAnnotations';
import { extractAnnotatedMainLine } from './moveImport';
import { MAX_MOVE_COMMENT_LENGTH } from './moveComment';

/**
 * A note has to survive the exporter and the importer, because a study that is
 * shared as a PGN and read back without its notes has lost the point of being
 * a study.
 *
 * The comment a move carries in a PGN holds two kinds of thing: commands the
 * app writes (`[%eval ...]`, "Better was <move>") and prose a person wrote.
 * Only the second is a note, and telling them apart on the way back in is the
 * whole of what these pin.
 */
function pgnFor(moves: Array<{ uci: string; comment?: string; evalScore?: number; quality?: 'blunder' }>) {
    return moves
        .map((move) => [move.uci, ...annotationTokensForMove(move)].join(' '))
        .join(' ');
}

describe('a note through a PGN and back', () => {
    it('comes back the way it went out', () => {
        const note = 'Chariot belongs here first, or the horse has no square.';
        const pgn = pgnFor([{ uci: 'b2e2', comment: note }, { uci: 'h9g7' }]);
        expect(pgn).toContain(note);

        const read = extractAnnotatedMainLine(pgn);
        expect(read.moves).toEqual(['b2e2', 'h9g7']);
        expect(read.annotations[0].comment).toBe(note);
        expect(read.annotations[1].comment).toBeUndefined();
    });

    it('rides beside the review the same comment carries', () => {
        const pgn = pgnFor([
            { uci: 'b2e2', comment: 'Book, but the follow-up matters more.', evalScore: 42, quality: 'blunder' },
        ]);
        const read = extractAnnotatedMainLine(pgn);
        expect(read.annotations[0].evalScore).toBe(42);
        expect(read.annotations[0].quality).toBe('blunder');
        expect(read.annotations[0].comment).toBe('Book, but the follow-up matters more.');
    });

    /**
     * The failure this guards: a comment holding only commands has no prose in
     * it, and reading one as a note would put "[%eval 0.42]" under every move
     * of every reviewed game imported back in.
     */
    it("does not read the app's own commands as a note", () => {
        const pgn = pgnFor([{ uci: 'b2e2', evalScore: 42 }, { uci: 'h9g7', evalScore: -900, quality: 'blunder' }]);
        const read = extractAnnotatedMainLine(pgn);
        expect(read.annotations[0].comment).toBeUndefined();
        expect(read.annotations[1].comment).toBeUndefined();
        expect(read.annotations[1].evalScore).toBe(-900);
    });

    /** A `}` in a note would end the comment and spill the rest into the moves. */
    it('cannot be made to end its own comment', () => {
        const pgn = pgnFor([{ uci: 'b2e2', comment: 'closes } here b9c7 b0c2' }, { uci: 'h9g7' }]);
        const read = extractAnnotatedMainLine(pgn);
        // Two moves, not four: the note's text stayed inside the comment.
        expect(read.moves).toEqual(['b2e2', 'h9g7']);
        expect(read.annotations[0].comment).toBe('closes here b9c7 b0c2');
    });

    it('bounds a note written by something other than this app', () => {
        const long = 'x'.repeat(MAX_MOVE_COMMENT_LENGTH + 400);
        const read = extractAnnotatedMainLine(`b2e2 { ${long} } h9g7`);
        expect(read.annotations[0].comment).toHaveLength(MAX_MOVE_COMMENT_LENGTH);
    });

    /** A variation's comment must not land on the main line's last move. */
    it('leaves a note inside a variation where it was', () => {
        const read = extractAnnotatedMainLine('b2e2 { main note } (b0c2 { side note }) h9g7');
        expect(read.moves).toEqual(['b2e2', 'h9g7']);
        expect(read.annotations[0].comment).toBe('main note');
        expect(read.annotations[1].comment).toBeUndefined();
    });
});
