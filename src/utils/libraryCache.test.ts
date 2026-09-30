import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_LIBRARY_STORAGE_KEY, loadAllGames, loadLibraryState, renameGame, saveGame } from './gameLibrary';

afterEach(() => vi.unstubAllGlobals());
function setup() {
    const entries = new Map<string, string>();
    const storage = {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
    };
    vi.stubGlobal('localStorage', storage);
    saveGame({ gameMode: 'PvP', moves: ['h2e2'] });
    saveGame({ gameMode: 'PvP', moves: ['b2e2'] });
    return { entries, storage };
}
describe('incremental library snapshots', () => {
    it('reuses unchanged state and records after a local rename', () => {
        setup();
        const before = loadLibraryState();
        expect(loadLibraryState()).toBe(before);
        renameGame(before.games[0].id, 'New label');
        const after = loadLibraryState();
        expect(after.games[0]).not.toBe(before.games[0]);
        expect(after.games[1]).toBe(before.games[1]);
        expect(after.games[0].label).toBe('New label');
        loadAllGames();
        expect(loadLibraryState().games).toEqual(after.games);
    });
    it('observes external changes but retains unchanged records', () => {
        const { entries } = setup();
        const before = loadLibraryState();
        const external = JSON.parse(entries.get(GAME_LIBRARY_STORAGE_KEY)!);
        external[0].label = 'Another tab';
        entries.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify(external));
        const after = loadLibraryState();
        expect(after.games[0].label).toBe('Another tab');
        expect(after.games[1]).toBe(before.games[1]);
        entries.set(GAME_LIBRARY_STORAGE_KEY, '[{"broken":true}]');
        expect(loadLibraryState().mutationBlocked).toBe(true);
        expect(saveGame({ gameMode: 'PvP', moves: ['h2e2'] })).toBeNull();
    });
    it('does not publish a failed write or hide inaccessible storage', () => {
        const { storage } = setup();
        const before = loadLibraryState();
        storage.setItem.mockImplementation(() => { throw Error('Quota'); });
        expect(renameGame(before.games[0].id, 'Lost')).toBe(false);
        expect(loadLibraryState()).toBe(before);
        storage.getItem = () => { throw Error('Blocked'); };
        expect(loadLibraryState().mutationBlocked).toBe(true);
    });
});
