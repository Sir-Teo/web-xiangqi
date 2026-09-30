import { afterEach, expect, it, vi } from 'vitest';
import { GAME_LIBRARY_STORAGE_KEY, latestLibraryRecovery, loadLibraryState, previewLibrarySalvage, salvageLibrary } from './gameLibrary';
afterEach(() => vi.unstubAllGlobals());
const game = { id: 'a', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'] };
function setup(raw: string, refuseArchive = false) {
  const data = new Map([[GAME_LIBRARY_STORAGE_KEY, raw]]);
  vi.stubGlobal('localStorage', { get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { if (refuseArchive && key !== GAME_LIBRARY_STORAGE_KEY) throw Error('quota'); data.set(key, value); } });
  return data;
}
it('previews readable records, keeps conflicting IDs as copies and archives exact original bytes', () => {
  const raw = JSON.stringify([game, {}, game, { ...game, rootComment: 'Different' }], null, 2);
  setup(raw);
  expect(previewLibrarySalvage(raw)).toMatchObject({ skipped: 2, copies: 1, error: null });
  expect(salvageLibrary(raw)).toEqual({ restored: 2, error: null });
  expect(latestLibraryRecovery()).toBe(raw);
  expect(loadLibraryState().mutationBlocked).toBe(false);
  expect(new Set(loadLibraryState().games.map(game => game.id)).size).toBe(2);
});
it('never replaces data when archiving fails, preview is stale or structure is unreadable', () => {
  const raw = JSON.stringify([game, {}]);
  const data = setup(raw, true);
  expect(salvageLibrary(raw).error).toMatch(/preserve/);
  expect(data.get(GAME_LIBRARY_STORAGE_KEY)).toBe(raw);
  expect(salvageLibrary('[]').error).toMatch(/changed/);
  expect(previewLibrarySalvage('{broken').error).toMatch(/manual recovery/);
});
