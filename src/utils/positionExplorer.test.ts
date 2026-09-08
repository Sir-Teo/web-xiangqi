import { describe, expect, it } from 'vitest';
import {
    buildLibraryPositionIndex,
    formatExplorerRecord,
    libraryPositionSignature,
    lookupLibraryPosition,
    selectLibraryPositionGames,
} from './positionExplorer';
import { START_FEN, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';
import type { SavedGame } from './gameLibrary';

function game(id: string, moves: string[], extra: Partial<SavedGame> = {}): SavedGame {
    return { id, savedAt: 1, gameMode: 'PvP', moves, ...extra };
}

/** The position after playing `moves` from the start, for looking one up. */
function positionAfter(moves: string[], startFen = START_FEN): { board: BoardState; sideToMove: Side } {
    const board = parseFenBoard(startFen);
    let sideToMove: Side = 'w';
    for (const uci of moves) {
        const result = validateMoveStr(uci, board, sideToMove);
        if (!result.ok) throw new Error(`${uci} is not legal here: ${result.reason}`);
        const mv = result.mv!;
        board[mv.toRank][mv.toFile] = board[mv.fromRank][mv.fromFile];
        board[mv.fromRank][mv.fromFile] = '';
        sideToMove = sideToMove === 'w' ? 'b' : 'w';
    }
    return { board, sideToMove };
}

const LIBRARY: SavedGame[] = [
    game('a', ['h2e2', 'h9g7', 'b0c2'], { result: 'red', label: 'Club night', opening: 'Central Cannon' }),
    game('b', ['h2e2', 'h9g7', 'h0g2'], { result: 'black' }),
    game('c', ['h2e2', 'h9g7', 'b0c2'], { result: 'draw' }),
    game('d', ['c3c4', 'c6c5'], { result: 'red' }),
];

describe('the position index', () => {
    const index = buildLibraryPositionIndex(LIBRARY);

    it('finds the games that reached a position', () => {
        const { board, sideToMove } = positionAfter(['h2e2', 'h9g7']);
        const report = lookupLibraryPosition(index, board, sideToMove);
        expect(report.games).toBe(3);
        expect(report.hits.map((hit) => hit.gameId).sort()).toEqual(['a', 'b', 'c']);
    });

    it('groups what was played from it, most played first, with the record', () => {
        const { board, sideToMove } = positionAfter(['h2e2', 'h9g7']);
        const report = lookupLibraryPosition(index, board, sideToMove);
        expect(report.moves.map((move) => move.uci)).toEqual(['b0c2', 'h0g2']);
        expect(report.moves[0]).toMatchObject({ uci: 'b0c2', games: 2, redWins: 1, blackWins: 0, draws: 1 });
        expect(report.moves[1]).toMatchObject({ uci: 'h0g2', games: 1, blackWins: 1 });
    });

    it('indexes the root, so the opening move is explorable too', () => {
        const { board, sideToMove } = positionAfter([]);
        const report = lookupLibraryPosition(index, board, sideToMove);
        expect(report.games).toBe(4);
        expect(report.moves.map((move) => move.uci)).toEqual(['h2e2', 'c3c4']);
    });

    it('records the final position with no continuation', () => {
        const { board, sideToMove } = positionAfter(['c3c4', 'c6c5']);
        const report = lookupLibraryPosition(index, board, sideToMove);
        expect(report.games).toBe(1);
        expect(report.moves).toEqual([]);
        expect(report.hits[0]).toMatchObject({ gameId: 'd', ply: 2, continuation: null });
    });

    it('carries the label and opening back for linking', () => {
        const { board, sideToMove } = positionAfter(['h2e2']);
        const report = lookupLibraryPosition(index, board, sideToMove);
        const hit = report.hits.find((entry) => entry.gameId === 'a');
        expect(hit).toMatchObject({ label: 'Club night', opening: 'Central Cannon', ply: 1 });
    });

    it('says nothing about a position no game reached', () => {
        const { board, sideToMove } = positionAfter(['g3g4']);
        expect(lookupLibraryPosition(index, board, sideToMove)).toEqual({ games: 0, moves: [], hits: [] });
    });

    it('has no opinion without an index', () => {
        const { board, sideToMove } = positionAfter([]);
        expect(lookupLibraryPosition(null, board, sideToMove).games).toBe(0);
    });
});

describe('positions that are the same position', () => {
    it('reaches the same entry by a different move order', () => {
        // 1. C2=5 H8+7 2. H8+7 and 1. H8+7 H8+7 2. C2=5 stand in the same
        // place. An explorer keyed on the move list would miss that; this is
        // keyed on the position.
        const index = buildLibraryPositionIndex([
            game('one', ['h2e2', 'h9g7', 'b0c2']),
            game('two', ['b0c2', 'h9g7', 'h2e2']),
        ]);
        const { board, sideToMove } = positionAfter(['h2e2', 'h9g7', 'b0c2']);
        expect(lookupLibraryPosition(index, board, sideToMove).games).toBe(2);
    });

    it('counts a game once however often it revisits a position', () => {
        // A chariot shuffling back and forth returns to the same position, and
        // that is one game reaching it, not three.
        const index = buildLibraryPositionIndex([
            game('shuffle', ['a0a1', 'a9a8', 'a1a0', 'a8a9', 'a0a1', 'a9a8']),
        ]);
        const { board, sideToMove } = positionAfter(['a0a1', 'a9a8']);
        const report = lookupLibraryPosition(index, board, sideToMove);
        expect(report.games).toBe(1);
        expect(report.hits.length).toBe(2);
    });
});

describe('records that do not replay', () => {
    it('drops the game rather than writing positions that never existed', () => {
        const index = buildLibraryPositionIndex([
            game('good', ['h2e2', 'h9g7']),
            game('bad', ['h2e2', 'a5a6']),      // no piece on a5
            game('junk', ['h2e2', 'not-a-move']),
        ]);
        expect(index.skipped).toBe(2);
        const { board, sideToMove } = positionAfter(['h2e2', 'h9g7']);
        expect(lookupLibraryPosition(index, board, sideToMove).games).toBe(1);
    });

    it('keeps what the bad game managed before it broke', () => {
        // Its first move was real, and dropping the whole game would lose a
        // position that genuinely occurred.
        const index = buildLibraryPositionIndex([game('bad', ['h2e2', 'a5a6'])]);
        const { board, sideToMove } = positionAfter(['h2e2']);
        expect(lookupLibraryPosition(index, board, sideToMove).games).toBe(1);
    });

    it('never recommends an illegal continuation, but retains the legal prefix', () => {
        for (const invalid of ['h9h8', 'a9a6', 'h9z9', 'h9a:', 'h9h9']) {
            const index = buildLibraryPositionIndex([game('bad', ['h2e2', invalid])]);
            const { board, sideToMove } = positionAfter(['h2e2']);
            const report = lookupLibraryPosition(index, board, sideToMove);
            expect(index.skipped).toBe(1);
            expect(report.games).toBe(1);
            expect(report.moves).toEqual([]);
            expect(report.hits[0].continuation).toBeNull();
            expect(index.byPosition.size).toBe(2);
        }
    });

    it('survives a start position that does not parse', () => {
        const index = buildLibraryPositionIndex([game('broken', ['h2e2'], { startFen: 'nonsense' })]);
        expect(index.skipped).toBe(1);
        expect(index.byPosition.size).toBe(0);
    });

    it('replays a custom start position from where it actually starts', () => {
        const startFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1';
        const index = buildLibraryPositionIndex([game('black-first', ['h7e7'], { startFen })]);
        const board = parseFenBoard(startFen.split(' ')[0]);
        expect(lookupLibraryPosition(index, board, 'b').moves[0]?.uci).toBe('h7e7');
    });
});

describe('a game still in progress', () => {
    it('counts toward how often a move was played, but not toward its record', () => {
        // 'ongoing' is not a result: a game the player stopped mid-way says
        // nothing about how the move did.
        const index = buildLibraryPositionIndex([
            game('done', ['h2e2'], { result: 'red' }),
            game('paused', ['h2e2'], { result: 'ongoing' }),
        ]);
        const { board, sideToMove } = positionAfter([]);
        const move = lookupLibraryPosition(index, board, sideToMove).moves[0];
        expect(move).toMatchObject({ games: 2, redWins: 1, blackWins: 0, draws: 0, unknown: 1 });
        expect(formatExplorerRecord(move)).toBe('1–0–0');
    });
});

describe('the signature', () => {
    it('changes when the library does and not otherwise', () => {
        expect(libraryPositionSignature(LIBRARY)).toBe(libraryPositionSignature(LIBRARY));
        expect(libraryPositionSignature(LIBRARY)).not.toBe(libraryPositionSignature(LIBRARY.slice(1)));
        const relabelled = [{ ...LIBRARY[0], moves: [...LIBRARY[0].moves, 'b9c7'] }, ...LIBRARY.slice(1)];
        expect(libraryPositionSignature(relabelled)).not.toBe(libraryPositionSignature(LIBRARY));
    });
});

describe('how a record reads', () => {
    it('writes wins–losses–draws when anything was decided', () => {
        expect(formatExplorerRecord({ uci: 'h2e2', games: 4, redWins: 2, blackWins: 1, draws: 1, unknown: 0 }))
            .toBe('2–1–1');
    });

    it('says so when nothing was decided, rather than repeating the game count', () => {
        // The count is already on the row beside this, and repeating it read
        // as "1 game / 1 game".
        expect(formatExplorerRecord({ uci: 'h2e2', games: 3, redWins: 0, blackWins: 0, draws: 0, unknown: 3 }))
            .toBe('no result saved');
        expect(formatExplorerRecord({ uci: 'h2e2', games: 1, redWins: 0, blackWins: 0, draws: 0, unknown: 1 }))
            .toBe('no result saved');
    });
});


describe('repertoire statistics remain tied to games', () => {
    it('counts a repeated continuation and its result once per game', () => {
        const moves = ['a0a1', 'a9a8', 'a1a0', 'a8a9', 'a0a1', 'a9a8'];
        const index = buildLibraryPositionIndex([game('shuffle', moves, { result: 'red' })]);
        const report = lookupLibraryPosition(index, parseFenBoard(START_FEN), 'w');
        expect(report.hits).toHaveLength(2);
        expect(report.moves[0]).toMatchObject({ games: 1, redWins: 1 });
    });

    it('invalidates the index for every displayed field and same-length move edits', () => {
        const original = game('study', ['h2e2']);
        for (const change of [
            { label: 'Renamed study' }, { opening: 'Updated opening' },
            { result: 'red' as const }, { moves: ['b2e2'] },
            { startFen: START_FEN + ' b - - 0 1' },
        ]) {
            expect(libraryPositionSignature([{ ...original, ...change }]))
                .not.toBe(libraryPositionSignature([original]));
        }
    });
});


describe('matching saved games', () => {
    it('returns the first occurrence per game in newest-save order, bounded for transfer', () => {
        const index = buildLibraryPositionIndex([
            game('old', ['a0a1', 'a9a8', 'a1a0', 'a8a9'], { savedAt: 10 }),
            game('new', ['h2e2'], { savedAt: 20 }),
        ]);
        const hits = lookupLibraryPosition(index, parseFenBoard(START_FEN), 'w').hits;
        expect(hits.length).toBe(3);
        expect(selectLibraryPositionGames(hits).map(hit => [hit.gameId, hit.ply]))
            .toEqual([['new', 0], ['old', 0]]);
        expect(selectLibraryPositionGames([...hits].reverse(), 1).map(hit => hit.gameId)).toEqual(['new']);
        expect(selectLibraryPositionGames(hits, 0)).toEqual([]);
    });
});
