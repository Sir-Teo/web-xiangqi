import { describe, expect, it } from 'vitest';
import { exportPgnCollection } from './pgnCollectionExport';
import { parsePgnCollection } from './pgnCollection';
import { MAX_SAVED_GAMES } from './gameLibrary';
import type { SavedGamePgnInput } from './savedGamePgn';

describe('portable saved-game collections', () => {
  it('reopens saved drafts that contain tournament metadata before any move', () => {
    const game: SavedGamePgnInput = { gameMode: 'PvP', moves: [], metadata: { redPlayer: 'Draft player', event: 'Upcoming match' } };
    expect(parsePgnCollection(exportPgnCollection([game]))[0]).toMatchObject({ moves: [], metadata: game.metadata });
    expect(() => parsePgnCollection('*')).toThrow(/No moves/);
    expect(() => parsePgnCollection('[Unknown "No saved facts"] *')).toThrow(/No moves/);
  });
  it('reopens ordered records with pinned lines, alternatives, annotations, metadata and a Black-to-move root', () => {
    const blackFen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17';
    const games: SavedGamePgnInput[] = [{
      gameMode: 'PvP', moves: ['b2e2'], mainLinePinned: true, result: 'black', rootComment: 'Opening plan',
      metadata: { redPlayer: '林 "A"', blackPlayer: 'Zhao \\ B', event: 'Club final', date: '2020.??.??' },
      moveTree: [{ uci: 'h2e2', comment: 'Primary preparation', nags: [1], evalScore: 125, evalDepth: 18,
        analysis: { version: 1, position: 'position startpos', move: 'h2e2', score: 125, scoreKind: 'cp', bounded: false,
          depth: 18, savedAt: 1, engine: { name: 'Pikafish collection', variant: 'single-simd', threads: 1, hashMB: 16 }, multiPv: 1 },
        children: [{ uci: 'h9g7', recordedResult: 'draw', comment: 'Agreed endpoint' }] },
      { uci: 'b2e2', comment: 'Alternative preparation', recordedResult: 'black-wins' }],
    }, { gameMode: 'PvP', moves: ['h9g7'], label: 'Black root', startFen: blackFen, rootComment: 'Black starts here' }];
    const original = structuredClone(games);
    const pgn = exportPgnCollection(games);
    const restored = parsePgnCollection(pgn);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ moves: ['h2e2', 'h9g7'], result: 'draw', rootComment: 'Opening plan',
      mainLinePinned: true, metadata: games[0].metadata });
    expect(restored[0].moveTree?.[0]).toMatchObject({ comment: 'Primary preparation', nags: [1], evalScore: 125, evalDepth: 18,
      analysis: games[0].moveTree?.[0].analysis });
    expect(restored[0].moveTree?.[1]).toMatchObject({ uci: 'b2e2', comment: 'Alternative preparation', recordedResult: 'black-wins' });
    expect(restored[1]).toMatchObject({ moves: ['h9g7'], startFen: blackFen, rootComment: 'Black starts here' });
    expect(pgn).toContain('17... h9g7');
    expect(games).toEqual(original);
  });

  it('refuses the entire collection when a later cursor disagrees with its tree', () => {
    const games: SavedGamePgnInput[] = [{ gameMode: 'PvP', moves: ['h2e2'] }, {
      gameMode: 'PvP', label: 'Keep my notes', moves: ['b2e2'], moveTree: [{ uci: 'h2e2', comment: 'Do not discard this note' }],
    }];
    const original = structuredClone(games);
    expect(() => exportPgnCollection(games)).toThrow(/Game 2 \(Keep my notes\).*No PGN was exported.*library backup/);
    expect(games).toEqual(original);
  });

  it('bounds the game count and accepts the full supported collection size', () => {
    expect(() => exportPgnCollection([])).toThrow(/No matching/);
    const games = Array.from({ length: MAX_SAVED_GAMES }, (_, index) => ({
      gameMode: 'PvP' as const, moves: ['h2e2'], label: `Game ${index + 1}`,
    }));
    expect(parsePgnCollection(exportPgnCollection(games))).toHaveLength(MAX_SAVED_GAMES);
    expect(() => exportPgnCollection([...games, games[0]])).toThrow(/Too many games/);
  });
});
