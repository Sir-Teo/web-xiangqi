import {
    boardToFen,
    findKing,
    parseFenBoard,
    inPalace,
    isInCheck,
    kingsFacing,
    otherSide,
    pieceSide,
    type BoardState,
    type Side,
} from './xiangqi';

/** The most of each piece a side can have; a set-up position may have fewer. */
const PIECE_LIMITS: Record<string, number> = { K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 };

const PIECE_WORDS: Record<string, string> = {
    K: 'general', A: 'advisor', B: 'elephant', N: 'horse', R: 'chariot', C: 'cannon', P: 'soldier',
};

function sideName(side: Side) {
    return side === 'w' ? 'Red' : 'Black';
}

/** Ranks measured from a side's own back rank, so the two sides share one rule. */
function ownRank(side: Side, rank: number) {
    return side === 'w' ? rank : 9 - rank;
}

function advisorPointOk(side: Side, file: number, rank: number) {
    const r = ownRank(side, rank);
    return (r === 1 && file === 4) || ((r === 0 || r === 2) && (file === 3 || file === 5));
}

function elephantPointOk(side: Side, file: number, rank: number) {
    const r = ownRank(side, rank);
    if (r === 0) return file === 2 || file === 6;
    if (r === 2) return file === 0 || file === 4 || file === 8;
    if (r === 4) return file === 2 || file === 6;
    return false;
}

function soldierPointOk(side: Side, file: number, rank: number) {
    const r = ownRank(side, rank);
    if (r < 3) return false;
    // A soldier cannot step sideways before crossing the river, so on its own
    // side it can only stand on the file it started on.
    if (r <= 4) return file % 2 === 0;
    return true;
}

/**
 * Why a hand-built position could not have arisen in a game, in one sentence,
 * or null when it could. The first problem found is the one reported: a
 * reader fixes one thing at a time.
 *
 * Counts and points are the rules of the set; the last two checks are the
 * same ones `useXiangqi` applies to a pasted FEN, stated here so the editor
 * can say them before the reader presses Done rather than refusing after.
 */
export function describeSetupProblem(board: BoardState, sideToMove: Side): string | null {
    const counts: Record<string, number> = {};
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            const piece = board[rank]?.[file];
            if (!piece) continue;
            const side = pieceSide(piece);
            const type = piece.toUpperCase();
            if (!side || !(type in PIECE_LIMITS)) continue;
            const key = `${side}${type}`;
            counts[key] = (counts[key] ?? 0) + 1;
            const word = `${sideName(side)} ${PIECE_WORDS[type]}`;
            if (type === 'A' && !advisorPointOk(side, file, rank)) return `A ${word} can only stand on the palace's five diagonal points.`;
            if (type === 'B' && !elephantPointOk(side, file, rank)) return `A ${word} can only stand on the seven elephant points on its own side.`;
            if (type === 'K' && !inPalace(side, file, rank)) return `The ${word} must stay inside its palace.`;
            if (type === 'P' && !soldierPointOk(side, file, rank)) {
                return ownRank(side, rank) < 3
                    ? `A ${word} cannot be behind its own starting rank.`
                    : `A ${word} that has not crossed the river must be on its starting file.`;
            }
        }
    }
    for (const side of ['w', 'b'] as const) {
        if ((counts[`${side}K`] ?? 0) !== 1) return `${sideName(side)} needs exactly one general.`;
        for (const [type, limit] of Object.entries(PIECE_LIMITS)) {
            if ((counts[`${side}${type}`] ?? 0) > limit) {
                return `${sideName(side)} can have at most ${limit} ${PIECE_WORDS[type]}${limit === 1 ? '' : 's'}.`;
            }
        }
    }
    if (!findKing(board, 'w') || !findKing(board, 'b')) return 'Both generals must be on the board.';
    if (kingsFacing(board)) return 'The generals face each other on an open file.';
    const waiting = otherSide(sideToMove);
    if (isInCheck(board, waiting)) {
        return `${sideName(waiting)}'s general is in check, but it is ${sideName(sideToMove)}'s move.`;
    }
    return null;
}

/**
 * Why a FEN could not be loaded, in the same one sentence, or null when it can.
 *
 * `describeSetupProblem` already worked all of this out and the FEN readers
 * threw the answer away: every path that takes a pasted position -- the New
 * Game field, a share link, an import -- said only "FEN must describe a legal
 * Xiangqi position with both generals and a side to move", which names four
 * things at once and none of the ones that are usually wrong. The editor,
 * standing next to the same field, has always said `A Red soldier that has not
 * crossed the river must be on its starting file.` This is that sentence, for
 * the field a reader actually pastes into.
 *
 * The three cases above the legality check are the ones `parseFenBoard` and the
 * side field reject before a board exists to describe. `parseFenBoard`'s own
 * throws are deliberately not forwarded -- they name ranks and files as the
 * parser counts them -- and are replaced with what a reader has to fix.
 */
export function describeFenProblem(fen: string): string | null {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2 || !parts[0]) {
        return 'A FEN is the pieces, then a space, then "w" or "b" for the side to move.';
    }
    let board: BoardState;
    try {
        board = parseFenBoard(parts[0]);
    } catch {
        return 'The piece layout is unreadable: ten ranks separated by "/", each adding up to nine files.';
    }
    if (parts[1] !== 'w' && parts[1] !== 'b') {
        // Quoted and clipped: this is whatever was pasted, and a paste that
        // went wrong can be a whole file.
        const seen = parts[1].length > 12 ? `${parts[1].slice(0, 12)}…` : parts[1];
        return `The side to move must be "w" or "b", not "${seen}".`;
    }
    return describeSetupProblem(board, parts[1]);
}

/**
 * The board a FEN draws, even when it is not a position a game could reach.
 *
 * `describeFenProblem` says no to two different kinds of thing, and only one
 * of them is a dead end. A layout that will not parse leaves nothing to show.
 * A layout that parses perfectly and breaks a rule of the game -- the generals
 * facing, a soldier off its file, two of something -- is a board a reader can
 * see and drag one piece on, and the editor already holds exactly such a board
 * and says what is wrong with it. This is what lets a refusal hand it over.
 *
 * The side falls back to Red when the FEN's own side field is unreadable,
 * since the editor has a toggle for it and no board at all is worse.
 */
export function readFenBoard(fen: string): { board: BoardState; sideToMove: Side } | null {
    const parts = fen.trim().split(/\s+/);
    try {
        // No empty-string guard above it: `parseFenBoard('')` throws on the
        // rank count, which is the same answer by the same route.
        return { board: parseFenBoard(parts[0]), sideToMove: parts[1] === 'b' ? 'b' : 'w' };
    } catch {
        return null;
    }
}

/** The FEN for a set-up position: fresh clocks, since no game led to it. */
export function setupFen(board: BoardState, sideToMove: Side): string {
    return boardToFen(board, sideToMove, 1, 0);
}

export function emptyBoard(): BoardState {
    return Array.from({ length: 10 }, () => Array(9).fill(''));
}
