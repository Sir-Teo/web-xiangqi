import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearStoredPreferences,
    isAiSpeed,
    isBoardOrientation,
    isDeepSearchMode,
    readStoredPreferences,
    writeStoredPreferences,
} from './preferences';
import { PREFERENCES_STORAGE_KEY } from './storageKeys';

/**
 * The preference round trip as the app performs it, through a real storage
 * object rather than through the normalizer alone.
 *
 * `preferences.test.ts` covers `normalizeStoredPreferencesValue`, which is
 * pure. Everything between that and the browser -- the three exported
 * functions the app actually calls -- had no test, because they read `window`
 * and the suite runs in node, so each one's `typeof window === 'undefined'`
 * guard could be inverted and nothing noticed. Inverted, saving a preference
 * does nothing at all: the "my setting didn't stick" bug, silently.
 */
function fakeStorage(overrides: Partial<Storage> = {}) {
    const map = new Map<string, string>();
    return {
        map,
        localStorage: {
            getItem: (key: string) => map.get(key) ?? null,
            setItem: (key: string, value: string) => { map.set(key, value); },
            removeItem: (key: string) => { map.delete(key); },
            ...overrides,
        },
    };
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal('window', { localStorage: store.localStorage });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('saving and reading preferences back', () => {
    it('returns what was written', () => {
        writeStoredPreferences({ soundEnabled: false, orientation: 'black', searchDepth: 14 });
        expect(readStoredPreferences()).toMatchObject({
            soundEnabled: false, orientation: 'black', searchDepth: 14,
        });
        // The control: it really went through storage, under the versioned key.
        expect(store.map.has(PREFERENCES_STORAGE_KEY)).toBe(true);
    });

    it('reads nothing back once cleared', () => {
        writeStoredPreferences({ soundEnabled: false });
        clearStoredPreferences();
        expect(readStoredPreferences()).toEqual({});
        expect(store.map.has(PREFERENCES_STORAGE_KEY)).toBe(false);
    });

    it('reads an empty set rather than throwing when storage refuses', () => {
        vi.stubGlobal('window', {
            localStorage: {
                getItem: () => { throw new Error('denied'); },
                setItem: () => { throw new Error('denied'); },
                removeItem: () => { throw new Error('denied'); },
            },
        });
        // A blocked-cookie or private-mode browser must still start.
        expect(() => writeStoredPreferences({ soundEnabled: false })).not.toThrow();
        expect(() => clearStoredPreferences()).not.toThrow();
        expect(readStoredPreferences()).toEqual({});
    });

    it('does nothing at all where there is no window', () => {
        vi.stubGlobal('window', undefined);
        expect(readStoredPreferences()).toEqual({});
        expect(() => writeStoredPreferences({ soundEnabled: false })).not.toThrow();
        expect(() => clearStoredPreferences()).not.toThrow();
    });
});

/**
 * The guards a stored value has to pass. Each is a list of accepted spellings,
 * and a mutation sweep showed the lists were never walked: an `===` flipped to
 * `!==` rejects the only value it should accept, which drops that preference
 * on load, and nothing failed.
 */
describe('recognising a stored value', () => {
    it('accepts every spelling it names, and nothing else', () => {
        for (const value of ['red', 'black']) expect(isBoardOrientation(value)).toBe(true);
        for (const value of ['slow', 'normal', 'fast', 'step']) expect(isAiSpeed(value)).toBe(true);
        for (const value of ['bounded', 'infinite']) expect(isDeepSearchMode(value)).toBe(true);

        for (const value of ['Red', 'blue', '', null, undefined, 0]) {
            expect(isBoardOrientation(value)).toBe(false);
        }
        expect(isAiSpeed('instant')).toBe(false);
        expect(isDeepSearchMode('unbounded')).toBe(false);
    });
});
