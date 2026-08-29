import { describe, expect, it } from 'vitest';
import {
    AUTO_SAVED_GAME_KEY,
    GAME_LIBRARY_STORAGE_KEY,
    LEGACY_STORAGE_KEYS,
    PREFERENCES_STORAGE_KEY,
    readVersionedStorage,
} from './storageKeys';
import type { KeyValueStorage } from './storage';

function makeStorage(initial: Record<string, string> = {}) {
    const entries = new Map(Object.entries(initial));
    const storage: KeyValueStorage & { entries: Map<string, string> } = {
        entries,
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
        removeItem: (key: string) => { entries.delete(key); },
    };
    return storage;
}

describe('versioned storage keys', () => {
    it('namespaces and versions every key, the way both siblings do', () => {
        for (const key of [PREFERENCES_STORAGE_KEY, AUTO_SAVED_GAME_KEY, GAME_LIBRARY_STORAGE_KEY]) {
            expect(key).toMatch(/^xiangqi:[a-z-]+:v\d+$/);
        }
    });

    it('reads the current key when it is there', () => {
        const storage = makeStorage({ [GAME_LIBRARY_STORAGE_KEY]: '[]' });
        expect(readVersionedStorage(GAME_LIBRARY_STORAGE_KEY, storage)).toBe('[]');
    });

    it('promotes a value saved under the old name', () => {
        const legacy = LEGACY_STORAGE_KEYS[GAME_LIBRARY_STORAGE_KEY]!;
        const storage = makeStorage({ [legacy]: '[{"id":"g1"}]' });

        expect(readVersionedStorage(GAME_LIBRARY_STORAGE_KEY, storage)).toBe('[{"id":"g1"}]');
        expect(storage.entries.get(GAME_LIBRARY_STORAGE_KEY)).toBe('[{"id":"g1"}]');
        expect(storage.entries.has(legacy), 'the old key is cleared once it has been promoted').toBe(false);
    });

    it('prefers the current key over a stale value under the old name', () => {
        const legacy = LEGACY_STORAGE_KEYS[AUTO_SAVED_GAME_KEY]!;
        const storage = makeStorage({ [AUTO_SAVED_GAME_KEY]: 'new', [legacy]: 'old' });
        expect(readVersionedStorage(AUTO_SAVED_GAME_KEY, storage)).toBe('new');
    });

    it('still returns the old value when the promotion write is refused', () => {
        const legacy = LEGACY_STORAGE_KEYS[PREFERENCES_STORAGE_KEY]!;
        const storage = makeStorage({ [legacy]: '{"a":1}' });
        const readOnly: KeyValueStorage = {
            getItem: storage.getItem,
            setItem: () => { throw new Error('quota'); },
            removeItem: storage.removeItem,
        };

        expect(readVersionedStorage(PREFERENCES_STORAGE_KEY, readOnly)).toBe('{"a":1}');
        expect(storage.entries.has(legacy), 'nothing is deleted when it could not be copied').toBe(true);
    });

    it('returns null when neither name holds anything', () => {
        expect(readVersionedStorage(GAME_LIBRARY_STORAGE_KEY, makeStorage())).toBeNull();
    });

    it('has no key without a legacy name recorded', () => {
        for (const key of [PREFERENCES_STORAGE_KEY, AUTO_SAVED_GAME_KEY, GAME_LIBRARY_STORAGE_KEY]) {
            expect(LEGACY_STORAGE_KEYS[key], `${key} needs its pre-versioning name`).toBeTruthy();
        }
    });
});
