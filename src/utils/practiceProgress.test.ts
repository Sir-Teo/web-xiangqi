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
