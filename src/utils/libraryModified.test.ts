import { afterEach, expect, it, vi } from 'vitest';
import { GAME_LIBRARY_STORAGE_KEY, loadAllGames, normalizeSavedGame, renameGame, updateSavedGameWithResult, type SavedGame } from './gameLibrary';
import { librarySource } from './librarySource';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('tracks edits separately from creation and sorts recently modified first', () => {
  const old: SavedGame = { id: 'old', savedAt: 100, gameMode: 'PvP', moves: ['h2e2'] };
  const newer = { ...old, id: 'new', savedAt: 200 };
  const store = new Map([[GAME_LIBRARY_STORAGE_KEY, JSON.stringify([old, newer])]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  vi.spyOn(Date, 'now').mockReturnValue(300);
  const source = loadAllGames().find(game => game.id === 'old')!;
  expect(renameGame(source.id, 'Renamed')).toBe(true);
  expect(loadAllGames()[0]).toMatchObject({ id: 'old', savedAt: 100, modifiedAt: 300 });
  expect(librarySource(loadAllGames()[0])).toEqual(librarySource(source));
  vi.spyOn(Date, 'now').mockReturnValue(400);
  const updated = updateSavedGameWithResult(source, { ...source, rootComment: 'New plan' });
  expect(updated.game).toMatchObject({ savedAt: 100, modifiedAt: 400, label: 'Renamed' });
});
it('accepts old records and ignores invalid or pre-creation modification dates', () => {
  const game = { id: 'a', savedAt: 100, gameMode: 'PvP', moves: ['h2e2'] };
  for (const modifiedAt of [undefined, 50, Infinity, '200']) expect(normalizeSavedGame({ ...game, modifiedAt })?.modifiedAt).toBeUndefined();
  expect(normalizeSavedGame({ ...game, modifiedAt: 200 })?.modifiedAt).toBe(200);
});
