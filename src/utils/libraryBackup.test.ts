import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    exportLibraryBackup, GAME_LIBRARY_STORAGE_KEY, loadLibraryState,
    MAX_SAVED_GAMES, previewLibraryRestore, restoreLibraryBackup,
} from './gameLibrary';

const store = new Map<string, string>();
const game = (id = 'study') => ({
    id, savedAt: 1700000000000, gameMode: 'PvP', moves: ['h2e2'], result: 'ongoing',
    label: 'Cannon study 炮', moveTree: [{ uci: 'h2e2', comment: 'Central cannon', children: [{ uci: 'h9g7' }] }],
});
const backup = (games: unknown[]) => JSON.stringify({ format: 'web-xiangqi-library', version: 1, games });
const raw = () => store.get(GAME_LIBRARY_STORAGE_KEY);
beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
    });
});

describe('portable library backups', () => {
    it('round-trips moves, branches, and comments and skips repeated imports', () => {
        store.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify([game()]));
        const original = loadLibraryState().games;
        const exported = exportLibraryBackup()!;
        store.clear();
        expect(previewLibraryRestore(exported)).toEqual({ added: 1, duplicates: 0, error: null });
        expect(raw()).toBeUndefined();
        expect(restoreLibraryBackup(exported).added).toBe(1);
        expect(loadLibraryState().games).toEqual(original);
        const saved = raw();
        expect(restoreLibraryBackup(exported)).toEqual({ added: 0, duplicates: 1, error: null });
        expect(raw()).toBe(saved);
    });
    it('rechecks current data at confirmation and preserves new games', () => {
        const text = backup([game('incoming')]);
        expect(previewLibraryRestore(text).added).toBe(1);
        store.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify([game('newer')]));
        expect(restoreLibraryBackup(text).error).toBeNull();
        expect(loadLibraryState().games.map(g => g.id)).toEqual(['newer', 'incoming']);
    });
    it('refuses conflicting identities without partial imports', () => {
        store.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify([game()]));
        const saved = raw();
        expect(restoreLibraryBackup(backup([game('new'), { ...game(), label: 'Different notes' }])).error).toMatch(/conflicts/);
        expect(raw()).toBe(saved);
    });
    it.each(['{broken', '', '{}', JSON.stringify([game()]), backup([{}]), backup([game(), game()]), ' '.repeat(3_001_025)])('refuses invalid backups', text => {
        expect(restoreLibraryBackup(text).error).toBeTruthy();
        expect(raw()).toBeUndefined();
    });
    it.each(['{broken', '', JSON.stringify([game(), {}]), JSON.stringify([game(), game()])])('keeps the exact damaged payload for recovery', text => {
        store.set(GAME_LIBRARY_STORAGE_KEY, text);
        expect(loadLibraryState()).toMatchObject({ mutationBlocked: true, raw: text });
        expect(exportLibraryBackup()).toBeNull();
        expect(restoreLibraryBackup(backup([game('incoming')])).error).toBeTruthy();
        expect(raw()).toBe(text);
    });
    it('refuses capacity overflow', () => {
        store.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify(Array.from({ length: MAX_SAVED_GAMES }, (_, i) => game(`${i}`))));
        const saved = raw();
        expect(restoreLibraryBackup(backup([game()])).error).toMatch(/limit/);
        expect(raw()).toBe(saved);
    });
    it('reports blocked reads and quota failures', () => {
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(loadLibraryState().mutationBlocked).toBe(true);
        expect(restoreLibraryBackup(backup([game()])).error).toBeTruthy();
        vi.mocked(localStorage.getItem).mockRestore();
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        expect(restoreLibraryBackup(backup([game()])).error).toMatch(/refused/);
        expect(raw()).toBeUndefined();
    });
});
