import { describe, expect, it } from 'vitest';
import type { SavedGame } from './gameLibrary';
import { savedGameLine, savedGamePositionResult } from './savedGameLine';
import { buildLibraryPositionIndex, libraryPositionSignature, lookupLibraryPosition } from './positionExplorer';
import { parseFenBoard, START_FEN } from './xiangqi';

const study: SavedGame = {
    id: 'study', savedAt: 1, gameMode: 'PvP', moves: ['b2e2'], result: 'black', mainLinePinned: true,
    moveTree: [
        { uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'draw' }] },
        { uci: 'b2e2', recordedResult: 'black-wins' },
    ],
};

describe('the outcome at the saved position', () => {
    it.each([['red-wins', 'red'], ['black-wins', 'black'], ['draw', 'draw']] as const)(
        'prefers an explicit %s to a conflicting legacy result', (recordedResult, result) => {
            expect(savedGamePositionResult({ ...study, result: 'ongoing', moveTree: [{ uci: 'b2e2', recordedResult }] })).toBe(result);
            expect(savedGamePositionResult({ ...study, moves: [], result: 'ongoing', rootResult: recordedResult })).toBe(result);
        },
    );
    it('uses the exact saved variation independently of pins and repeated replies', () => {
        const game: SavedGame = { ...study, moves: ['b2e2', 'h9g7'], result: 'red', moveTree: [
            { uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'red-wins' }] },
            { uci: 'b2e2', children: [{ uci: 'h9g7', recordedResult: 'black-wins' }] },
        ] };
        expect(savedGamePositionResult(game)).toBe('black');
    });
    it('stops at the saved position, including a root with continuations', () => {
        const game: SavedGame = { ...study, moves: ['h2e2'], moveTree: [
            { uci: 'h2e2', recordedResult: 'draw', children: [{ uci: 'h9g7', recordedResult: 'red-wins' }] },
        ] };
        expect(savedGamePositionResult(game)).toBe('draw');
        expect(savedGamePositionResult({ ...game, moves: [], rootResult: 'black-wins' })).toBe('black');
    });
    it('retains legacy outcomes when the saved position has no declaration', () => {
        expect(savedGamePositionResult({ ...study, moveTree: undefined })).toBe('black');
        expect(savedGamePositionResult({ ...study, moveTree: [{ uci: 'b2e2' }] })).toBe('black');
        expect(savedGamePositionResult({ ...study, moves: [], rootResult: undefined })).toBe('black');
        expect(savedGamePositionResult({ ...study, moveTree: undefined, result: undefined })).toBeUndefined();
    });
});

describe('the primary line of a saved game', () => {
    it('uses the pinned line and its result instead of the saved variation', () => {
        expect(savedGameLine(study)).toEqual({ moves: ['h2e2', 'h9g7'], result: 'draw' });
        const report = lookupLibraryPosition(buildLibraryPositionIndex([study]), parseFenBoard(START_FEN), 'w');
        expect(report.games).toBe(1);
        expect(report.moves).toEqual([{ uci: 'h2e2', games: 1, redWins: 0, blackWins: 0, draws: 1, unknown: 0 }]);
    });

    it('continues from a saved cursor, including the root, without counting other variations', () => {
        for (const moves of [[], ['h2e2']]) {
            expect(savedGameLine({ ...study, moves, mainLinePinned: undefined, result: 'ongoing' }))
                .toEqual({ moves: ['h2e2', 'h9g7'], result: 'draw' });
        }
        expect(savedGameLine({ ...study, mainLinePinned: undefined }))
            .toEqual({ moves: ['b2e2'], result: 'black' });
    });

    it('does not give an extension or another line the saved cursor result', () => {
        const moveTree = [{ uci: 'h2e2', recordedResult: 'draw' as const, children: [{ uci: 'h9g7' }] }];
        expect(savedGameLine({ ...study, moves: ['h2e2'], result: 'draw', moveTree }).result).toBeUndefined();
        expect(savedGameLine({ ...study, moveTree }).result).toBeUndefined();
    });

    it('retains legacy results at their endpoint and root-only declarations', () => {
        expect(savedGameLine({ ...study, mainLinePinned: undefined, moveTree: undefined }).result).toBe('black');
        expect(savedGameLine({ ...study, moves: [], moveTree: undefined, result: 'ongoing', rootResult: 'draw' }).result).toBe('draw');
        expect(savedGameLine({ ...study, moveTree: [{ uci: 'b2e2' }] }).result).toBe('black');
    });

    it('invalidates statistics on a pin, primary continuation, or endpoint-result change', () => {
        const signature = libraryPositionSignature([study]);
        for (const changed of [
            { ...study, mainLinePinned: undefined },
            { ...study, moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9i7', recordedResult: 'draw' as const }] }] },
            { ...study, moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'red-wins' as const }] }] },
        ]) expect(libraryPositionSignature([changed])).not.toBe(signature);
        expect(libraryPositionSignature([{ ...study, moves: [], result: 'ongoing' }])).toBe(signature);
    });

    it('prefers an endpoint result to the saved one when the line reaches the end', () => {
        // Found by mutation: `moves.length < game.moves.length` widened to
        // `<=` returns early here with the *saved* result, so a game whose
        // final move carries its own recorded outcome shows the stale one on
        // its library card.
        const game: SavedGame = {
            id: 'ends', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'], result: 'ongoing',
            moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'draw' }] }],
        };
        expect(savedGameLine(game)).toEqual({ moves: ['h2e2', 'h9g7'], result: 'draw' });
    });

    it('withholds the saved result from a pinned line that stops short of it', () => {
        // `atSavedEndpoint` needs both halves: the lengths must match *and* the
        // moves must agree. Joined with `||`, a pinned line that is merely a
        // prefix of the saved path inherits the saved result, putting a
        // decisive badge on a line that never reaches the end.
        const game: SavedGame = {
            id: 'short', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'], result: 'red',
            mainLinePinned: true,
            moveTree: [{ uci: 'h2e2' }],
        };
        expect(savedGameLine(game)).toEqual({ moves: ['h2e2'], result: undefined });
    });

    it('leaves malformed saved paths for the existing legality checks', () => {
        expect(savedGameLine({ ...study, mainLinePinned: undefined, moves: ['h2e2', 'a5a6'] }))
            .toEqual({ moves: ['h2e2', 'a5a6'], result: 'black' });
    });
});
