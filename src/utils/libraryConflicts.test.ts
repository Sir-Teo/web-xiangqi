import { afterEach, expect, it, vi } from 'vitest';
import { GAME_LIBRARY_STORAGE_KEY, loadLibraryState, previewLibraryRestore, restoreLibraryBackup, type LibraryRestoreChoices } from './gameLibrary';
afterEach(() => vi.unstubAllGlobals());
const game = (id: string) => ({ id, savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], rootComment: 'Current' });
const backup = (ids: string[]) => JSON.stringify({ format: 'web-xiangqi-library', version: 1, games: ids.map(id => ({ ...game(id), rootComment: 'Backup' })) });
function setup() {
  const data = new Map([[GAME_LIBRARY_STORAGE_KEY, JSON.stringify(['keep', 'replace', 'copy'].map(game))]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } });
  return data;
}
it('merges per-study keep, replace and copy choices with unrelated additions', () => {
  setup(); const text = backup(['keep', 'replace', 'copy', 'new']);
  const preview = previewLibraryRestore(text);
  expect(preview.conflicts).toHaveLength(3);
  const choices = Object.fromEntries(preview.conflicts!.map(c => [c.id, { choice: c.id, expected: JSON.stringify(c.current) }])) as LibraryRestoreChoices;
  expect(restoreLibraryBackup(text, choices)).toMatchObject({ added: 2, replaced: 1, kept: 1, error: null });
  const games = loadLibraryState().games;
  expect(games.find(game => game.id === 'keep')?.rootComment).toBe('Current');
  expect(games.find(game => game.id === 'replace')?.rootComment).toBe('Backup');
  expect(games.find(game => game.id === 'copy')?.rootComment).toBe('Current');
  expect(games.filter(game => game.rootComment === 'Backup')).toHaveLength(3);
});
it('refuses a replacement after the current record changed or was deleted', () => {
  const store = setup(); const text = backup(['replace']);
  const current = previewLibraryRestore(text).conflicts![0].current;
  const choices: LibraryRestoreChoices = { replace: { choice: 'replace', expected: JSON.stringify(current) } };
  for (const games of [[{ ...current, rootComment: 'Newer edit' }], []]) {
    store.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify(games));
    expect(restoreLibraryBackup(text, choices).error).toMatch(/changed since preview/);
    expect(store.get(GAME_LIBRARY_STORAGE_KEY)).toBe(JSON.stringify(games));
  }
});
