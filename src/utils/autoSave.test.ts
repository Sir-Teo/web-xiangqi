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
    it('retains metadata after the final note or move is removed', () => {
        const { storage } = stubStorage();
        const metadata = { redPlayer: '王 Alice', event: 'Autumn Invitational' };
        expect(writeAutoSavedGame({ ...GAME, metadata }, storage, 1)).toBe('saved');
        expect(writeAutoSavedGame({ ...GAME, moves: [], metadata }, storage, 2)).toBe('saved');
        expect(readAutoSavedGame(storage)?.game.metadata).toEqual(metadata);
        expect(readAutoSavedGame(storage)?.game.moves).toEqual([]);
        expect(writeAutoSavedGame({ ...GAME, moves: [], metadata: { event: '  ' } }, storage, 3)).toBe('empty');
        expect(readAutoSavedGame(storage)).toBeNull();
    });
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

    it('does not report success for a line the recovery reader cannot load', () => {
        const { storage, entries } = stubStorage();
        const moves = Array.from({ length: 1024 }, (_, i) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4]);
        expect(writeAutoSavedGame({ ...GAME, moves }, storage, 1)).toBe('saved');
        expect(readAutoSavedGame(storage)?.game.moves).toHaveLength(1024);
        expect(writeAutoSavedGame({ ...GAME, moves: [...moves, 'a0a1'] }, storage, 2)).toBe('too-large');
        expect(entries.has(AUTO_SAVED_GAME_KEY)).toBe(false);
    });

    it('counts the whole study, including branches outside the current line', () => {
        const { storage, entries } = stubStorage();
        const children = Array.from({ length: 4096 }, () => ({ uci: 'h9g7' }));
        const moveTree = [{ uci: 'h2e2', children }, { uci: 'b2e2', children }];
        writeAutoSavedGame(GAME, storage, 1);
        expect(writeAutoSavedGame({ ...GAME, moveTree }, storage, 2)).toBe('too-large');
        expect(entries.has(AUTO_SAVED_GAME_KEY)).toBe(false);
    });

    it('rejects a too-deep side line even when the saved cursor is short', () => {
        const { storage, entries } = stubStorage();
        let line: { uci: string; children?: unknown[] }[] = [];
        for (let i = 0; i < 1025; i++) line = [{ uci: 'h2e2', children: line }];
        writeAutoSavedGame(GAME, storage, 1);
        expect(writeAutoSavedGame({ ...GAME, moveTree: line as AutoSaveInput['moveTree'] }, storage, 2)).toBe('too-large');
        expect(entries.has(AUTO_SAVED_GAME_KEY)).toBe(false);
    });

    it('rejects other unreadable snapshots before claiming they were saved', () => {
        const { storage, entries } = stubStorage();
        writeAutoSavedGame(GAME, storage, 1);
        expect(writeAutoSavedGame({ ...GAME, moves: ['not-a-move'] }, storage, 2)).toBe('failed');
        expect(entries.has(AUTO_SAVED_GAME_KEY)).toBe(false);
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
        // The game inside has to be one that *would* be restored, or this
        // passes without the version check doing anything: `GAME` is an
        // AutoSaveInput and carries no `savedAt`, so `normalizeSavedGame`
        // rejects it on its own and the version is never what decided.
        // Confirmed by mutation: deleting `parsed.version !== 1` left the old
        // form of this test green.
        const { storage } = stubStorage();
        const restorable = { ...GAME, id: 'x', savedAt: 1_700_000_000_000 };
        storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({ version: 1, savedAt: 1, game: restorable }));
        expect(readAutoSavedGame(storage), 'the fixture must be restorable at version 1').not.toBeNull();

        storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({ version: 2, savedAt: 1, game: restorable }));
        expect(readAutoSavedGame(storage)).toBeNull();

        storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({ savedAt: 1, game: restorable }));
        expect(readAutoSavedGame(storage), 'a snapshot with no version at all').toBeNull();
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
