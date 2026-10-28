import { expect, it } from 'vitest';
import type { SavedGame } from './gameLibrary';
import { librarySource } from './librarySource';
import { readPracticeProgress, writePracticeProgress } from './practiceProgress';
import { migratePracticeProgressRevision, practiceRevision, PRACTICE_PROGRESS_KEY } from './practiceProgressStore';
import { preparePracticeStudy } from './studyPractice';

const game: SavedGame = { id: 'progress', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] };
// A persisted v1 fingerprint from before practice had its own content identity.
const legacyRevision = 'e8980357:ded6ca03:89';
const red = { line: 0, moves: ['h2e2'], completed: [], answered: 1, recalled: 1, assisted: false };
const black = { line: 0, moves: [], completed: [], answered: 3, recalled: 2, assisted: false };
function legacyStore() {
  const values = new Map([[PRACTICE_PROGRESS_KEY, JSON.stringify([
    { id: game.id, revision: legacyRevision, side: 'w', updatedAt: 1, sessions: { w: red, b: black }, extra: 'Retain unknown fields' },
  ])]]);
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}
const entry = (store: ReturnType<typeof legacyStore>) => JSON.parse(store.getItem(PRACTICE_PROGRESS_KEY)!)[0];

it('restores legacy progress and keeps the other side when the next practice write upgrades it', () => {
  expect(librarySource(game).revision).toBe(legacyRevision);
  const store = legacyStore();
  const study = preparePracticeStudy(game).study!;
  const restored = readPracticeProgress(game, study, 'w', store)!;
  expect(restored.session.moves).toEqual(red.moves);
  expect(writePracticeProgress(game, 'w', restored.session, store)).toBe(true);
  expect(entry(store).revision).toBe(practiceRevision(game));
  expect(entry(store).sessions.b).toEqual(black);
});

it('migrates both legacy sides before a cosmetic library update without rewriting their history', () => {
  const store = legacyStore();
  const before = entry(store);
  expect(migratePracticeProgressRevision(game, store)).toBe(true);
  expect(entry(store)).toEqual({ ...before, revision: practiceRevision(game) });
  const updated: SavedGame = { ...game, moves: [], cursorPly: 0, modifiedAt: 2, metadata: { event: 'Club match' },
    moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }] };
  const study = preparePracticeStudy(updated).study!;
  expect(readPracticeProgress(updated, study, 'w', store)?.session.moves).toEqual(red.moves);
  expect(readPracticeProgress(updated, study, 'b', store)?.session.recalled).toBe(2);
});

it('leaves unmatched legacy revisions and already current records untouched', () => {
  const store = legacyStore();
  const original = store.getItem(PRACTICE_PROGRESS_KEY);
  expect(migratePracticeProgressRevision({ ...game, rootComment: 'Different training notes' }, store)).toBe(true);
  expect(store.getItem(PRACTICE_PROGRESS_KEY)).toBe(original);
  migratePracticeProgressRevision(game, store);
  const upgraded = store.getItem(PRACTICE_PROGRESS_KEY);
  migratePracticeProgressRevision({ ...game, metadata: { event: 'New event' } }, store);
  expect(store.getItem(PRACTICE_PROGRESS_KEY)).toBe(upgraded);
});

it('preserves malformed or future practice data instead of sanitizing it during a library update', () => {
  for (const raw of ['not JSON', '[null]', JSON.stringify([entry(legacyStore()), { future: true }])]) {
    const store = legacyStore(); store.setItem(PRACTICE_PROGRESS_KEY, raw);
    expect(migratePracticeProgressRevision(game, store)).toBe(false);
    expect(store.getItem(PRACTICE_PROGRESS_KEY)).toBe(raw);
  }
});

it('keeps legacy data usable if migration storage is unavailable', () => {
  const store = legacyStore();
  const before = store.getItem(PRACTICE_PROGRESS_KEY);
  expect(migratePracticeProgressRevision(game, { getItem: store.getItem, setItem: () => { throw Error('quota'); } })).toBe(false);
  expect(store.getItem(PRACTICE_PROGRESS_KEY)).toBe(before);
  expect(readPracticeProgress(game, preparePracticeStudy(game).study!, 'w', store)?.session.moves).toEqual(red.moves);
});

it('bounds invalid cyclic trees while preserving the stored progress', () => {
  const store = legacyStore();
  const loop: NonNullable<SavedGame['moveTree']>[number] = { uci: 'h2e2' }; loop.children = [loop];
  const invalid = { ...game, moveTree: [loop] };
  expect(() => practiceRevision(invalid)).toThrow('Invalid practice study length');
  expect(migratePracticeProgressRevision(invalid, store)).toBe(true); // Its legacy fingerprint does not match.
  expect(entry(store).revision).toBe(legacyRevision);
});
