import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_LIBRARY_STORAGE_KEY, MAX_SAVED_GAMES, loadLibraryState, updateSavedGameWithResult, type SavedGame } from './gameLibrary';

const store = new Map<string, string>();
const game = (id = 'study'): SavedGame => ({ id, savedAt: 123, gameMode: 'PvP', moves: ['h2e2'], label: 'Cannon study',
  metadata: { redPlayer: '王' }, moveTree: [{ uci: 'h2e2', comment: 'Old note' }] });
const write = (games: SavedGame[]) => store.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify(games));
const raw = () => store.get(GAME_LIBRARY_STORAGE_KEY);
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

describe('explicit saved study updates', () => {
  it('replaces content while retaining identity, date, name and unrelated records', () => {
    write([game(), game('other')]);
    const source = loadLibraryState().games[0];
    const originalOther = loadLibraryState().games[1];
    const replacement = { ...source, label: 'Ignore this label', rootComment: 'New plan',
      moveTree: [{ uci: 'h2e2', comment: 'Updated note', children: [{ uci: 'h9g7' }] }, { uci: 'b2e2' }] };
    const result = updateSavedGameWithResult(source, replacement);
    expect(result.error).toBeNull();
    expect(result.game).toMatchObject({ id: 'study', savedAt: 123, label: 'Cannon study', rootComment: 'New plan', moveTree: replacement.moveTree });
    const after = loadLibraryState().games;
    expect(after).toHaveLength(2);
    expect(after[1]).toEqual(originalOther);
    expect(source.rootComment).toBeUndefined();
  });
  it('updates a full library without consuming another slot', () => {
    write(Array.from({ length: MAX_SAVED_GAMES }, (_, i) => game(`${i}`)));
    const source = loadLibraryState().games[0];
    expect(updateSavedGameWithResult(source, { ...source, rootComment: 'New' }).error).toBeNull();
    expect(loadLibraryState().games).toHaveLength(MAX_SAVED_GAMES);
  });
  it('keeps a newer label and re-reads other games before writing', () => {
    write([game()]);
    const source = loadLibraryState().games[0];
    write([{ ...game(), label: 'Renamed elsewhere' }, game('newer')]);
    expect(updateSavedGameWithResult(source, { ...source, rootComment: 'New' }).game?.label).toBe('Renamed elsewhere');
    expect(loadLibraryState().games.map(game => game.id)).toEqual(['study', 'newer']);
  });
  it('refuses a stale board after another edit, including metadata-only changes', () => {
    for (const changed of [{ ...game(), rootComment: 'Other edit' }, { ...game(), metadata: { event: 'New event' } }]) {
      write([game()]); const source = loadLibraryState().games[0];
      write([changed]); const before = raw();
      expect(updateSavedGameWithResult(source, { ...source, rootComment: 'My edit' }).error).toMatch(/changed since/);
      expect(raw()).toBe(before);
    }
  });
  it('does not recreate a deleted source or overwrite damaged storage', () => {
    const source = game(); write([]);
    expect(updateSavedGameWithResult(source, source).error).toMatch(/no longer/);
    for (const damaged of ['{broken', JSON.stringify([game(), {}])]) {
      store.set(GAME_LIBRARY_STORAGE_KEY, damaged);
      expect(updateSavedGameWithResult(source, source).error).toMatch(/could not be read/);
      expect(raw()).toBe(damaged);
    }
  });
  it('leaves the source intact after invalid data or a refused write', () => {
    write([game()]); const source = loadLibraryState().games[0]; const before = raw();
    expect(updateSavedGameWithResult(source, { ...source, moves: ['bad'] }).error).toMatch(/invalid/);
    expect(raw()).toBe(before);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(updateSavedGameWithResult(source, { ...source, rootComment: 'New' }).error).toMatch(/full, blocked/);
    expect(raw()).toBe(before);
  });
});
