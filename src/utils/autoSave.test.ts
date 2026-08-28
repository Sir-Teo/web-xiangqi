import { describe, expect, it } from 'vitest';
import {
    AUTO_SAVED_GAME_KEY,
    AUTO_SAVE_MAX_BYTES,
    type AutoSaveInput,
    clearAutoSavedGame,
    isWorthAutoSaving,
    readAutoSavedGame,
    writeAutoSavedGame,
} from './autoSave';

/** Just the three methods autoSave reaches for. */
function stubStorage(overrides: Partial<Storage> = {}) {
    const entries = new Map<string, string>();
    const storage = {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, String(value)); },
        removeItem: (key: string) => { entries.delete(key); },
        ...overrides,
    };
    return { storage, entries };
}

const GAME: AutoSaveInput = {
    gameMode: 'PvP',
    moves: ['h2e2', 'h9g7'],
    startFen: undefined,
    result: 'ongoing',
    label: 'In progress',
};

describe('deciding what is worth keeping', () => {
    it('keeps a game that has moves, a tree, or a custom start', () => {
        expect(isWorthAutoSaving(GAME)).toBe(true);
        expect(isWorthAutoSaving({ ...GAME, moves: [], moveTree: [{ uci: 'h2e2' }] })).toBe(true);
        expect(isWorthAutoSaving({ ...GAME, moves: [], startFen: '5k3/9/9/9/9/9/9/9/9/4K4 w - - 0 1' })).toBe(true);
    });

    it('does not keep an untouched board', () => {
        expect(isWorthAutoSaving({ ...GAME, moves: [], moveTree: undefined, startFen: undefined })).toBe(false);
    });
});

describe('writing and reading back', () => {
    it('round-trips the game in progress', () => {
        const { storage } = stubStorage();
        expect(writeAutoSavedGame(GAME, storage, 1234)).toBe('saved');

        const restored = readAutoSavedGame(storage);
        expect(restored?.savedAt).toBe(1234);
        expect(restored?.game.moves).toEqual(['h2e2', 'h9g7']);
        expect(restored?.game.gameMode).toBe('PvP');
        expect(restored?.game.label).toBe('In progress');
    });

    it('clears the slot rather than storing an untouched board', () => {
        const { storage, entries } = stubStorage();
        writeAutoSavedGame(GAME, storage, 1)
        expect(writeAutoSavedGame({ ...GAME, moves: [] }, storage, 2)).toBe('empty');
        expect(entries.has(AUTO_SAVED_GAME_KEY)).toBe(false);
    });

    it('overwrites the previous snapshot instead of accumulating', () => {
        const { storage, entries } = stubStorage();
        writeAutoSavedGame(GAME, storage, 1);
        writeAutoSavedGame({ ...GAME, moves: ['b2e2'] }, storage, 2);

        expect(entries.size).toBe(1);
        expect(readAutoSavedGame(storage)?.game.moves).toEqual(['b2e2']);
    });

    it('forgets a snapshot too big to be worth keeping', () => {
        const { storage, entries } = stubStorage();
        writeAutoSavedGame(GAME, storage, 1);

        const huge = { ...GAME, label: 'x'.repeat(AUTO_SAVE_MAX_BYTES + 10) };
        expect(writeAutoSavedGame(huge, storage, 2)).toBe('too-large');
        expect(entries.has(AUTO_SAVED_GAME_KEY)).toBe(false);
    });

    it('reports a storage that refuses the write', () => {
        const { storage } = stubStorage({
            setItem: () => { throw new Error('QuotaExceededError'); },
        });
        expect(writeAutoSavedGame(GAME, storage, 1)).toBe('failed');
    });

    it('does nothing at all without storage', () => {
        expect(writeAutoSavedGame(GAME, null, 1)).toBe('failed');
        expect(readAutoSavedGame(null)).toBeNull();
        expect(() => clearAutoSavedGame(null)).not.toThrow();
    });
});

describe('refusing to restore something unusable', () => {
    it('reads nothing when the slot is empty or corrupt', () => {
        const { storage } = stubStorage();
        expect(readAutoSavedGame(storage)).toBeNull();

        storage.setItem(AUTO_SAVED_GAME_KEY, '{not json');
        expect(readAutoSavedGame(storage)).toBeNull();
    });

    it('rejects a snapshot from a version it does not know', () => {
        const { storage } = stubStorage();
        storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({ version: 2, savedAt: 1, game: { ...GAME, id: 'x' } }));
        expect(readAutoSavedGame(storage)).toBeNull();
    });

    it('rejects a snapshot whose game does not survive validation', () => {
        const { storage } = stubStorage();
        storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({ version: 1, savedAt: 1, game: { nonsense: true } }));
        expect(readAutoSavedGame(storage)).toBeNull();

        storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({
            version: 1,
            savedAt: 1,
            game: { ...GAME, id: 'auto-save', savedAt: 1, gameMode: 'NotAMode' },
        }));
        expect(readAutoSavedGame(storage)).toBeNull();
    });

    it('rejects a snapshot with no usable timestamp', () => {
        const { storage } = stubStorage();
        storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({
            version: 1,
            savedAt: 'yesterday',
            game: { ...GAME, id: 'auto-save', savedAt: 1 },
        }));
        expect(readAutoSavedGame(storage)).toBeNull();
    });

    it('clears the slot on request', () => {
        const { storage, entries } = stubStorage();
        writeAutoSavedGame(GAME, storage, 1);
        clearAutoSavedGame(storage);
        expect(entries.has(AUTO_SAVED_GAME_KEY)).toBe(false);
        expect(readAutoSavedGame(storage)).toBeNull();
    });
});
