import { START_FEN, parseFenBoard, pieceSide, type BoardState, type Side } from './xiangqi';
import { positionKey } from './repetition';
import type { SavedGame } from './gameLibrary';

/**
 * "Have I been here before?" — an opening explorer over the games you own.
 *
 * The library already holds every game the player saved, and it could only be
 * read one game at a time: to find out whether a position had come up before,
 * and what was played from it, you had to remember which game it was in. That
 * is the question a repertoire is *made of*, and it is the one thing an
 * explorer does that nothing else here does.
 *
 * It is deliberately not a masters database. It answers over the player's own
 * games, which is the half of Lichess's explorer that needs no data source, no
 * network, and no licence — and the half that is actually about you.
 *
 * ## Only the line that was played
 *
 * A saved game may also carry a `moveTree` of variations. Those are not
 * indexed: a variation is a position someone *considered*, and counting it
 * beside a game that was actually played would put analysis and results in the
 * same tally. `moves` is the main line, and the main line is the game.
 *
 * ## Identity
 *
 * `positionKey` from the repetition module, which is the placement and the side
 * to move and nothing else. Move counters differ on every visit and would make
 * every position unique — the same reason repetition detection excludes them.
 * Reusing it means the explorer and the repetition rule cannot disagree about
 * what "the same position" means.
 */

export type ExplorerResult = 'red-wins' | 'black-wins' | 'draw' | 'unknown';

export interface LibraryPositionHit {
    gameId: string;
    label?: string;
    opening?: string;
    result: ExplorerResult;
    /** Plies played before the position stood, so ply 0 is the root. */
    ply: number;
    /** The move played from it in that game, or null if the game ended there. */
    continuation: string | null;
}

export interface LibraryPositionMove {
    uci: string;
    games: number;
    redWins: number;
    blackWins: number;
    draws: number;
    unknown: number;
}

export interface LibraryPositionReport {
    /** Distinct games that reached the position. */
    games: number;
    /** What was played from it, most played first. */
    moves: LibraryPositionMove[];
    /** Every occurrence, newest game first, for linking back. */
    hits: LibraryPositionHit[];
}

export interface LibraryPositionIndex {
    /** Identifies the library this was built from, so a stale index is visible. */
    signature: string;
    byPosition: Map<string, LibraryPositionHit[]>;
    /** Games skipped because their moves did not replay. */
    skipped: number;
}

const EMPTY_REPORT: LibraryPositionReport = { games: 0, moves: [], hits: [] };

/**
 * A saved result as the explorer counts it.
 *
 * The library stores `'red' | 'black' | 'draw' | 'ongoing'`, and `'ongoing'`
 * is not a result -- a game the player stopped mid-way says nothing about the
 * move that was played, so it counts toward how *often* a move was chosen and
 * not toward how it did.
 */
function resultOf(game: SavedGame): ExplorerResult {
    switch (game.result) {
        case 'red':
            return 'red-wins';
        case 'black':
            return 'black-wins';
        case 'draw':
            return 'draw';
        default:
            return 'unknown';
    }
}

/**
 * A saved game's start position, or null if it does not parse.
 *
 * Records are validated on the way out of storage, so this should not fail --
 * but the index runs over whatever is there, and one bad record must cost that
 * record rather than the whole explorer.
 */
function startPositionOf(game: SavedGame): { board: BoardState; sideToMove: Side } | null {
    try {
        const fen = String(game.startFen || '').trim();
        if (!fen) return { board: parseFenBoard(START_FEN), sideToMove: 'w' };
        const parts = fen.split(/\s+/);
        return { board: parseFenBoard(parts[0]), sideToMove: parts[1] === 'b' ? 'b' : 'w' };
    } catch {
        return null;
    }
}

/**
 * Replays each game once and records every position it stood in.
 *
 * Built whole rather than searched per lookup: a full library is 500 games of
 * up to 1024 moves, and replaying all of it for every position the user steps
 * through would be the same work over and over. This way it is paid once per
 * change to the library.
 *
 * Moves are applied without re-validating them. They were validated when the
 * game was saved and again by `normalizeSavedGame` on the way back in, and a
 * legality check here would multiply the cost of the index by the cost of move
 * generation. A move naming an empty square is treated as a corrupt record and
 * abandons that game rather than writing a position that never existed.
 */
export function buildLibraryPositionIndex(games: SavedGame[]): LibraryPositionIndex {
    const byPosition = new Map<string, LibraryPositionHit[]>();
    let skipped = 0;

    for (const game of games) {
        const start = startPositionOf(game);
        if (!start) { skipped += 1; continue; }

        const board = start.board;
        let side = start.sideToMove;
        const moves = Array.isArray(game.moves) ? game.moves : [];
        const result = resultOf(game);
        let abandoned = false;

        for (let ply = 0; ply <= moves.length; ply += 1) {
            const key = positionKey(board, side);
            const hit: LibraryPositionHit = {
                gameId: game.id,
                label: game.label,
                opening: game.opening,
                result,
                ply,
                continuation: ply < moves.length ? moves[ply] : null,
            };
            const existing = byPosition.get(key);
            if (existing) existing.push(hit);
            else byPosition.set(key, [hit]);

            if (ply === moves.length) break;

            const uci = String(moves[ply] || '').toLowerCase();
            const fromFile = uci.charCodeAt(0) - 97;
            const fromRank = uci.charCodeAt(1) - 48;
            const toFile = uci.charCodeAt(2) - 97;
            const toRank = uci.charCodeAt(3) - 48;
            const piece = board[fromRank]?.[fromFile];
            if (uci.length !== 4 || !piece || pieceSide(piece) !== side) { abandoned = true; break; }
            board[toRank][toFile] = piece;
            board[fromRank][fromFile] = '';
            side = side === 'w' ? 'b' : 'w';
        }

        if (abandoned) skipped += 1;
    }

    return { signature: libraryPositionSignature(games), byPosition, skipped };
}

/** Include every field the index exposes, including same-length edits and renames. */
export function libraryPositionSignature(games: SavedGame[]): string {
    return JSON.stringify(games.map(({ id, savedAt, moves, startFen, result, label, opening }) =>
        [id, savedAt, moves, startFen, result, label, opening]));
}

function compareMoves(left: LibraryPositionMove, right: LibraryPositionMove): number {
    return right.games - left.games || left.uci.localeCompare(right.uci);
}

/** What the library says about one position, or an empty report if nothing does. */
export function lookupLibraryPosition(
    index: LibraryPositionIndex | null,
    board: BoardState,
    sideToMove: Side
): LibraryPositionReport {
    if (!index) return EMPTY_REPORT;
    const hits = index.byPosition.get(positionKey(board, sideToMove));
    if (!hits?.length) return EMPTY_REPORT;

    const byMove = new Map<string, LibraryPositionMove>();
    const countedGamesByMove = new Map<string, Set<string>>();
    for (const hit of hits) {
        if (!hit.continuation) continue;
        const counted = countedGamesByMove.get(hit.continuation) ?? new Set<string>();
        if (counted.has(hit.gameId)) continue;
        counted.add(hit.gameId);
        countedGamesByMove.set(hit.continuation, counted);
        let entry = byMove.get(hit.continuation);
        if (!entry) {
            entry = { uci: hit.continuation, games: 0, redWins: 0, blackWins: 0, draws: 0, unknown: 0 };
            byMove.set(hit.continuation, entry);
        }
        entry.games += 1;
        if (hit.result === 'red-wins') entry.redWins += 1;
        else if (hit.result === 'black-wins') entry.blackWins += 1;
        else if (hit.result === 'draw') entry.draws += 1;
        else entry.unknown += 1;
    }

    return {
        // Distinct games, not occurrences: a game that shuffles back to the
        // same position would otherwise count itself twice.
        games: new Set(hits.map((hit) => hit.gameId)).size,
        moves: Array.from(byMove.values()).sort(compareMoves),
        hits,
    };
}

/**
 * How a continuation's record reads: red wins, black wins, draws.
 *
 * When nothing was decided it says so rather than falling back to the game
 * count -- the count is already on the row beside this, and repeating it read
 * as "1 game / 1 game".
 */
export function formatExplorerRecord(move: LibraryPositionMove): string {
    const decided = move.redWins + move.blackWins + move.draws;
    if (decided === 0) return 'no result saved';
    return `${move.redWins}–${move.blackWins}–${move.draws}`;
}
