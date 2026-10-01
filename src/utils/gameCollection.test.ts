import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_LIBRARY_STORAGE_KEY, saveGameCollection } from './gameLibrary';

const game = { gameMode: 'PvP' as const, moves: ['h2e2'], metadata: { redPlayer: 'Alice' } };
afterEach(() => vi.unstubAllGlobals());
function storage(initial = '[]') {
  let raw = initial;
  const setItem = vi.fn((_key: string, text: string) => { raw = text; });
  vi.stubGlobal('localStorage', { getItem: () => raw, setItem });
  return { setItem, read: () => raw };
}
describe('atomic collection saves', () => {
  it('appends all games in one write and preserves existing games', () => {
    const original = { ...game, id: 'old', savedAt: 1 };
    const store = storage(JSON.stringify([original]));
    expect(saveGameCollection([game, { ...game, moves: ['b2e2'] }], true)).toEqual({ added: 2, error: null });
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(store.setItem.mock.calls[0][0]).toBe(GAME_LIBRARY_STORAGE_KEY);
    const games = JSON.parse(store.read());
    expect(games).toHaveLength(3);
    expect(games[0]).toMatchObject(original);
    expect(new Set(games.map((g: {id: string}) => g.id)).size).toBe(3);
  });
  it('skips repeated content across IDs, compact/tree forms and the incoming batch', () => {
    const original = { ...game, id: 'old', savedAt: 1, label: 'Renamed locally' };
    const store = storage(JSON.stringify([original]));
    expect(saveGameCollection([game, { ...game, moveTree: [{ uci: 'h2e2' }] }, { ...game, moves: ['b2e2'] }, { ...game, moves: ['b2e2'] }]))
      .toEqual({ added: 1, duplicates: 3, error: null });
    expect(JSON.parse(store.read())).toHaveLength(2);
    expect(saveGameCollection([{ ...game, rootComment: 'Different notes' }]).added).toBe(1);
  });
  it('allows duplicates to be skipped even at capacity', () => {
    const store = storage(JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ ...game, id: String(i), savedAt: 1 }))));
    expect(saveGameCollection([game])).toEqual({ added: 0, duplicates: 1, error: null });
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('keeps corrupt and full libraries unchanged', () => {
    for (const raw of ['damaged', JSON.stringify(Array.from({length:500}, (_,i) => ({...game,id:String(i),savedAt:1})))]) {
      const store = storage(raw);
      expect(saveGameCollection([game], true).error).toBeTruthy();
      expect(store.read()).toBe(raw);
      expect(store.setItem).not.toHaveBeenCalled();
    }
  });
  it('rejects invalid batches before writing and reports quota failures', () => {
    const store = storage();
    expect(saveGameCollection([game, {...game,moves:['invalid']}]).error).toBeTruthy();
    expect(store.setItem).not.toHaveBeenCalled();
    store.setItem.mockImplementation(() => { throw new Error('quota'); });
    expect(saveGameCollection([game]).added).toBe(0);
    expect(store.read()).toBe('[]');
  });
});
