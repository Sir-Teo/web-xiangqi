/**
 * Every key this app puts in browser storage, in one place.
 *
 * Both siblings namespace and version their keys — web-katrain uses
 * `web-katrain:thing:v1`, web-chess uses `webchess:thing:v1` — and this repo
 * used bare kebab-case names with no version. That is not a style question.
 * The saved review summary is the case that makes it concrete: the grading
 * ladder cannot be corrected while every stored review is written under a key
 * that says nothing about which scale produced it, because the library sorts
 * and averages across both at once. A version in the key is what turns that
 * from a reason not to fix the grading into a migration.
 *
 * `readVersionedStorage` reads the current key and falls back to the legacy
 * one, promoting what it finds. Nobody loses a saved game to a rename.
 */
import { readStorage, removeStorage, writeStorage, type KeyValueStorage, getLocalStorage } from './storage';

export const BEGINNER_GUIDE_STORAGE_KEY = 'xiangqi:beginner-guide-dismissed:v1';
export const PREFERENCES_STORAGE_KEY = 'xiangqi:preferences:v1';
export const AUTO_SAVED_GAME_KEY = 'xiangqi:auto-saved-game:v1';
export const GAME_LIBRARY_STORAGE_KEY = 'xiangqi:library:v1';

/** What each key was called before it was namespaced and versioned. */
export const LEGACY_STORAGE_KEYS: Readonly<Record<string, string>> = {
    [PREFERENCES_STORAGE_KEY]: 'xiangqi-app-preferences',
    [AUTO_SAVED_GAME_KEY]: 'xiangqi-auto-saved-game',
    [GAME_LIBRARY_STORAGE_KEY]: 'xiangqi-game-library',
};

/**
 * Reads `key`, falling back to the pre-versioning name and moving the value
 * across when it is found. The promotion is best effort: a storage that
 * refuses the write still returns the value, so a reader in private mode sees
 * its data rather than an empty library.
 */
export function readVersionedStorage(
    key: string,
    storage: KeyValueStorage | null = getLocalStorage(),
): string | null {
    const current = readStorage(key, storage);
    if (current !== null) return current;

    const legacyKey = LEGACY_STORAGE_KEYS[key];
    if (!legacyKey) return null;

    const legacy = readStorage(legacyKey, storage);
    if (legacy === null) return null;

    if (writeStorage(key, legacy, storage)) removeStorage(legacyKey, storage);
    return legacy;
}
