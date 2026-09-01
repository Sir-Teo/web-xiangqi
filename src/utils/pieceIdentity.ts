import type { BoardState } from './xiangqi';

/**
 * Stable identities for the pieces on the board, so a move can be animated.
 *
 * `Board.css` gives `.piece` a 300ms `left`/`top` transition, and it had never
 * once fired. The piece elements were keyed by the square they stand on, so a
 * move unmounts the element on the source square and mounts a different one on
 * the destination; a freshly mounted element has no previous `left` to
 * transition from, so it simply appears at the end of the move. Measured in a
 * browser rather than inferred: stepping one move back on a loaded game ran
 * **zero** `transitionrun` events and replaced exactly one of the 31 piece
 * nodes.
 *
 * Keying by identity instead means the moving piece keeps its DOM node, the
 * commit changes its `left`/`top`, and the transition the stylesheet already
 * describes is what carries it across.
 *
 * ## Only a single move is carried across
 *
 * Identity is transferred when the two boards differ by exactly one move. A
 * jump — loading a game, clicking into the move tree, flipping to a variation
 * — rebuilds every id under a new generation, so nothing animates and no piece
 * appears to slide somewhere it never went. That is the intended behaviour:
 * an animation is only honest about a change it can actually describe.
 *
 * The diff is deliberately direction-agnostic, because stepping *back* is the
 * navigation a reader performs most and it is the same shape in reverse. Both
 * of these are one move and both animate:
 *
 * | | source square | destination square |
 * | --- | --- | --- |
 * | play `h2e2` capturing | `C` → `''` | `c` → `C` |
 * | undo it | `''` → `C` | `C` → `c` |
 *
 * Reading the second row as "the piece arrived on h2, having left e2" is what
 * makes undo slide the cannon home instead of teleporting it. The pairing is
 * found by asking which of the two changed squares holds, afterwards, the
 * piece the other one held before — which is true of exactly one ordering
 * unless two pieces swapped, and one move cannot swap two pieces.
 */
export interface PieceIdentityState {
    /**
     * The board these ids describe.
     *
     * Held so a re-render with the same board returns the same state object
     * rather than recomputing. That is what makes calling this during render
     * idempotent, which React's double-invoked development render requires.
     */
    board: BoardState;
    /** A stable id per square, `''` where the square is empty. */
    ids: string[][];
    /** Where a carried-over piece just landed, or null when nothing moved. */
    movedTo: { file: number; rank: number } | null;
    /** Bumped whenever ids are rebuilt, so a stale key cannot be reused. */
    generation: number;
    /** The next unused serial inside this generation. */
    serial: number;
}

function emptyIds(): string[][] {
    return Array.from({ length: 10 }, () => Array<string>(9).fill(''));
}

function buildFresh(board: BoardState, generation: number): PieceIdentityState {
    const ids = emptyIds();
    let serial = 0;
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            if (!board[rank]?.[file]) continue;
            ids[rank][file] = `g${generation}p${serial}`;
            serial += 1;
        }
    }
    return { board, ids, movedTo: null, generation, serial };
}

interface ChangedSquare {
    file: number;
    rank: number;
    before: string;
    after: string;
}

function changedSquares(previous: BoardState, next: BoardState, limit: number): ChangedSquare[] | null {
    const changed: ChangedSquare[] = [];
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            const before = previous[rank]?.[file] ?? '';
            const after = next[rank]?.[file] ?? '';
            if (before === after) continue;
            // More than a move's worth of difference: stop early rather than
            // walk the rest of a board that is going to be rebuilt anyway.
            if (changed.length === limit) return null;
            changed.push({ file, rank, before, after });
        }
    }
    return changed;
}

/**
 * The pairing of the two changed squares, or null if they are not one move.
 *
 * `departure` is where the moving piece stood and `arrival` is where it now
 * stands, whichever direction the board was stepped in.
 */
function readSingleMove(
    changed: ChangedSquare[]
): { departure: ChangedSquare; arrival: ChangedSquare } | null {
    const [first, second] = changed;
    const forward = second.after !== '' && first.before === second.after;
    const backward = first.after !== '' && second.before === first.after;
    // Both directions valid would mean two pieces traded squares, which no
    // single move can do. Refusing it keeps a wrong slide off the board.
    if (forward === backward) return null;
    return forward
        ? { departure: first, arrival: second }
        : { departure: second, arrival: first };
}

/**
 * The ids for `board`, carrying identity across a single move.
 *
 * Pure in `(previous, board)`, and returns `previous` unchanged when handed
 * the same board, so it is safe to call during render.
 */
export function nextPieceIdentityState(
    previous: PieceIdentityState | null,
    board: BoardState
): PieceIdentityState {
    if (!previous) return buildFresh(board, 0);
    if (previous.board === board) return previous;

    const changed = changedSquares(previous.board, board, 2);

    // A different array holding the same position — stepping away and back
    // lands here. Keep the ids; there is nothing to animate and nothing to
    // rebuild.
    if (changed && changed.length === 0) {
        return { ...previous, board, movedTo: null };
    }

    const move = changed?.length === 2 ? readSingleMove(changed) : null;
    if (!move) return buildFresh(board, previous.generation + 1);

    const { departure, arrival } = move;
    const ids = previous.ids.map((row) => row.slice());
    ids[arrival.rank][arrival.file] = previous.ids[departure.rank][departure.file];
    // Undoing a capture puts a piece back on the square the mover left, and
    // that piece is new to the DOM: it has to be given an id of its own rather
    // than inheriting the one that just travelled away from it.
    let serial = previous.serial;
    if (departure.after === '') {
        ids[departure.rank][departure.file] = '';
    } else {
        ids[departure.rank][departure.file] = `g${previous.generation}p${serial}`;
        serial += 1;
    }

    return {
        board,
        ids,
        movedTo: { file: arrival.file, rank: arrival.rank },
        generation: previous.generation,
        serial,
    };
}
