import { expect, it } from 'vitest';
import { readPracticeProgress, writePracticeProgress, restorePracticeSession } from './practiceProgress';
import { preparePracticeStudy, startPracticeLine, attemptPracticeMove } from './studyPractice';
import type { SavedGame } from './gameLibrary';
import { START_FEN } from './xiangqi';
const game: SavedGame = { id: 'a', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] };
const study = preparePracticeStudy(game).study!;
function storage() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; }
it('restores the board from moves, maintains separate sides, and invalidates edited studies', () => {
  const store = storage();
  const session = attemptPracticeMove(study, startPracticeLine(study, 0), 'w', 'h2e2').session;
  expect(writePracticeProgress(game, 'w', session, store)).toBe(true);
  expect(readPracticeProgress(game, study, undefined, store)?.session).toEqual(session);
  writePracticeProgress(game, 'b', startPracticeLine(study, 0), store);
  expect(readPracticeProgress(game, study, 'w', store)?.session.recalled).toBe(1);
  expect(readPracticeProgress(game, study, undefined, store)?.side).toBe('b');
  expect(readPracticeProgress({ ...game, rootComment: 'Changed' }, study, 'w', store)).toBeNull();
});
it('keeps practice progress when saving details or browsing an unchanged repertoire', () => {
  const store = storage();
  const session = attemptPracticeMove(study, startPracticeLine(study, 0), 'w', 'h2e2').session;
  writePracticeProgress(game, 'w', session, store);
  const details: SavedGame = { ...game, modifiedAt: 2, cursorPly: 0, gameMode: 'AIvAI', rootResult: 'draw',
    startFen: `${START_FEN.replace('/9/', '/111111111/')} w - - 47 32`,
    metadata: { event: 'Club match' }, opening: 'Central Cannon', finalEval: 42, result: 'draw' };
  expect(readPracticeProgress(details, preparePracticeStudy(details).study!, 'w', store)?.session.moves).toEqual(['h2e2']);
  const browsed: SavedGame = { ...details, moves: [],
    moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }] };
  expect(readPracticeProgress(browsed, preparePracticeStudy(browsed).study!, 'w', store)?.session.moves).toEqual(['h2e2']);
});
it('starts fresh when the saved training moves, notes, starting board or line order change', () => {
  const repertoire: SavedGame = { ...game, moveTree: [
    { uci: 'h2e2', children: [{ uci: 'h9g7' }] }, { uci: 'b2e2', children: [{ uci: 'h9g7' }] },
  ] };
  const prepared = preparePracticeStudy(repertoire).study!;
  const store = storage();
  writePracticeProgress(repertoire, 'w', attemptPracticeMove(prepared, startPracticeLine(prepared, 0), 'w', 'h2e2').session, store);
  const ranks = START_FEN.split('/'); ranks[5] = 'P8'; ranks[6] = '2P1P1P1P';
  for (const changed of [
    { ...repertoire, rootComment: 'New plan' },
    { ...repertoire, moveTree: [{ ...repertoire.moveTree![0], comment: 'New move note' }, repertoire.moveTree![1]] },
    { ...repertoire, moveTree: repertoire.moveTree!.slice().reverse() },
    { ...repertoire, moveTree: [{ uci: 'h2e2', children: [{ uci: 'b9c7' }] }] },
    { ...repertoire, startFen: `${ranks.join('/')} w - - 0 1` },
  ]) {
    const changedStudy = preparePracticeStudy(changed).study;
    expect(changedStudy).not.toBeNull();
    expect(readPracticeProgress(changed, changedStudy!, 'w', store)).toBeNull();
  }
});
it('rejects invalid paths and counters, and reports refused storage', () => {
  const session = startPracticeLine(study, 0);
  for (const patch of [{ moves: ['b2e2'] }, { line: 1 }, { recalled: 2 }, { completed: [-1] }, { answered: Infinity }]) {
    expect(restorePracticeSession(study, { ...session, ...patch })).toBeNull();
  }
  expect(writePracticeProgress(game, 'w', session, { getItem: () => null, setItem: () => { throw Error('quota'); } })).toBe(false);
});

it.each([
  { color: 'w', other: 'b', move: 'h2e2', startFen: undefined },
  { color: 'b', other: 'w', move: 'h9g7', startFen: `${START_FEN} b - - 0 1` },
] as const)('preserves valid progress when an older $color study session chose a side with no moves', ({ color, other, move, startFen }) => {
  const oneMove: SavedGame = { ...game, moves: [move], startFen };
  const oneSide = preparePracticeStudy(oneMove).study!;
  const store = storage();
  const session = attemptPracticeMove(oneSide, startPracticeLine(oneSide, 0), color, move).session;
  writePracticeProgress(oneMove, color, session, store);
  // Older UI wrote the existing session under a color with no saved moves.
  writePracticeProgress(oneMove, other, session, store);
  expect(readPracticeProgress(oneMove, oneSide, undefined, store)).toEqual({ side: color, session });
  expect(readPracticeProgress(oneMove, oneSide, other, store)).toBeNull();
});
