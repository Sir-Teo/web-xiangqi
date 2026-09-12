import { START_FEN, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';
import { positionKey } from './repetition';
import type { SavedGame } from './gameLibrary';
import { savedGameLine } from './savedGameLine';

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
 * counted as additional games. Index one primary line per record, following
 * its explicit pin or its saved path and remaining first-child continuation,
 * just like PGN export. The saved cursor alone is not the complete game.
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
    savedAt: number;
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
    /** Every occurrence, grouped by input game order, for linking back. */
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
function resultOf(result: SavedGame['result']): ExplorerResult {
    switch (result) {
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
 * Storage validates move syntax, not legality. Validate before publishing a
 * continuation, retaining the reachable prefix if a damaged record stops.
 */
export function buildLibraryPositionIndex(games: SavedGame[]): LibraryPositionIndex {
    const byPosition = new Map<string, LibraryPositionHit[]>();
    let skipped = 0;

    for (const game of games) {
        const start = startPositionOf(game);
        if (!start) { skipped += 1; continue; }

        const board = start.board;
        let side = start.sideToMove;
        const line = savedGameLine(game);
        const moves = line.moves;
        const result = resultOf(line.result);
        let abandoned = false;

        for (let ply = 0; ply <= moves.length; ply += 1) {
            const key = positionKey(board, side);
            const validation = ply < moves.length ? validateMoveStr(moves[ply], board, side) : null;
            const move = validation?.ok ? validation.mv : null;
            const hit: LibraryPositionHit = {
                gameId: game.id,
                savedAt: game.savedAt,
                label: game.label,
                opening: game.opening,
                result,
                ply,
                continuation: move?.raw ?? null,
            };
            const existing = byPosition.get(key);
            if (existing) existing.push(hit);
            else byPosition.set(key, [hit]);

            if (ply === moves.length) break;

            if (!move) { abandoned = true; break; }
            board[move.toRank][move.toFile] = board[move.fromRank][move.fromFile];
            board[move.fromRank][move.fromFile] = '';
            side = side === 'w' ? 'b' : 'w';
        }

        if (abandoned) skipped += 1;
    }

    return { signature: libraryPositionSignature(games), byPosition, skipped };
}

/** Include every field the index exposes, including same-length edits and renames. */
export function libraryPositionSignature(games: SavedGame[]): string {
    return JSON.stringify(games.map(game => {
        const { moves, result } = savedGameLine(game);
        return [game.id, game.savedAt, moves, game.startFen, result, game.label, game.opening];
    }));
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

/** Keep one reachable occurrence per game, newest saves first, with bounded transfer. */
export function selectLibraryPositionGames(hits: LibraryPositionHit[], limit = 8): LibraryPositionHit[] {
    const games = new Map<string, LibraryPositionHit>();
    for (const hit of hits) {
        const previous = games.get(hit.gameId);
        if (!previous || hit.ply < previous.ply) games.set(hit.gameId, hit);
    }
    return [...games.values()]
        .sort((a, b) => b.savedAt - a.savedAt || a.gameId.localeCompare(b.gameId))
        .slice(0, Math.max(0, Math.trunc(limit)));
}
