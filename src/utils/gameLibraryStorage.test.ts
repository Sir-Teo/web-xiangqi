import { beforeEach, describe, expect, it } from 'vitest';
import {
    GAME_LIBRARY_STORAGE_KEY,
    deleteGame,
    loadAllGames,
    renameGame,
    restoreGame,
    saveGame,
} from './gameLibrary';

/**
 * The two guards on the stored library, neither of which had a test.
 *
 * The rest of `gameLibrary.test.ts` exercises the normalisers, which are pure.
 * Everything that touches storage was left to the browser suites, and the caps
 * live there: shrinking `MAX_SAVED_GAMES` from 500 to 5, or
 * `MAX_LIBRARY_JSON_LENGTH` from three million to a hundred, broke nothing in
 * the unit suite. Both are silent data loss -- the first drops games the player
 * saved, the second makes a real library unreadable.
 *
 * A stub is enough: the module reaches storage through `getLocalStorage()` at
 * call time, so there is no module state to reset beyond the store itself.
 */

const store = new Map<string, string>();

beforeEach(() => {
    store.clear();
    (globalThis as unknown as Record<string, unknown>).localStorage = {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => { store.set(key, String(value)); },
        removeItem: (key: string) => { store.delete(key); },
        key: (index: number) => [...store.keys()][index] ?? null,
        clear: () => store.clear(),
        get length() { return store.size; },
    };
});

const save = (moves: string[], opening?: string) =>
    saveGame({ gameMode: 'PvP', moves, result: 'ongoing', opening } as never);

describe('how many games the library keeps', () => {
    it('holds far more than a handful', () => {
        for (let i = 0; i < 40; i += 1) save(['h2e2', 'h9g7', 'b0c2'].slice(0, (i % 3) + 1));
        expect(loadAllGames()).toHaveLength(40);
    });

    it('refuses game 501 without evicting an existing game', () => {
        for (let i = 0; i < 500; i += 1) expect(save(['h2e2'], `game-${i}`)).not.toBeNull();
        const before = store.get(GAME_LIBRARY_STORAGE_KEY);
        expect(save(['b2e2'], 'game-500')).toBeNull();
        expect(store.get(GAME_LIBRARY_STORAGE_KEY)).toBe(before);
        expect(loadAllGames()).toHaveLength(500);
        const oldest = loadAllGames().find(game => game.opening === 'game-0')!;
        expect(renameGame(oldest.id, 'Keep me')).toBe(true);
        expect(deleteGame(oldest.id)).toBe(true);
        expect(save(['b2e2'], 'game-500')).not.toBeNull();
        expect(loadAllGames()).toHaveLength(500);
    });
});

describe('renaming one saved game', () => {
    /**
     * `renameGame` was called three times in this file and its effect was
     * never checked -- only its return value. Found by mutation: inverting
     * `g.id === id` to `!==` relabels **every other game in the library** and
     * still returns true, so the rename reports success while quietly
     * overwriting the names of everything the player did not touch.
     */
    it('changes that game and leaves the rest alone', () => {
        expect(save(['h2e2'], 'first')).not.toBeNull();
        expect(save(['b2e2'], 'second')).not.toBeNull();
        expect(save(['c3c4'], 'third')).not.toBeNull();
        const target = loadAllGames().find((game) => game.opening === 'second')!;

        expect(renameGame(target.id, 'My repertoire')).toBe(true);

        const after = loadAllGames();
        expect(after.find((game) => game.id === target.id)?.label).toBe('My repertoire');
        for (const game of after) {
            if (game.id === target.id) continue;
            expect(game.label ?? '').not.toBe('My repertoire');
        }
    });

    it('clears a label when renamed to nothing', () => {
        expect(save(['h2e2'], 'only')).not.toBeNull();
        const target = loadAllGames()[0];
        expect(renameGame(target.id, 'Named')).toBe(true);
        expect(loadAllGames()[0].label).toBe('Named');
        expect(renameGame(target.id, '   ')).toBe(true);
        expect(loadAllGames()[0].label ?? '').toBe('');
    });
});

describe('a stored library too large to read', () => {
    const oversized = () => JSON.stringify([{
        id: 'huge', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'],
        opening: 'x'.repeat(3_000_001),
    }]);

    it('reads as empty rather than throwing', () => {
        store.set(GAME_LIBRARY_STORAGE_KEY, oversized());
        expect(loadAllGames()).toEqual([]);
    });

    it('refuses every mutation instead of writing over it', () => {
        // The point of the guard: what cannot be read must not be replaced by
        // a normalised version of nothing, which would destroy it.
        const raw = oversized();
        store.set(GAME_LIBRARY_STORAGE_KEY, raw);

        expect(save(['h2e2'])).toBeNull();
        expect(deleteGame('huge')).toBe(false);
        expect(renameGame('huge', 'something')).toBe(false);
        expect(store.get(GAME_LIBRARY_STORAGE_KEY)).toBe(raw);
    });

    it('lets a library just under the ceiling through', () => {
        store.set(GAME_LIBRARY_STORAGE_KEY, JSON.stringify([{
            id: 'ok', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'],
        }]));
        expect(loadAllGames()).toHaveLength(1);
        expect(save(['b2e2'])).not.toBeNull();
        expect(loadAllGames()).toHaveLength(2);
    });
});


describe('writes must remain readable', () => {
    it('rejects a write crossing the read ceiling and preserves the existing library', () => {
        const existing = Array.from({ length: 400 }, (_, i) => ({
            id: `game-${i}`, savedAt: i + 1, gameMode: 'PvP',
            moves: Array(1024).fill('h2e2'),
        }));
        const raw = JSON.stringify(existing);
        expect(raw.length).toBeLessThan(3_000_000);
        store.set(GAME_LIBRARY_STORAGE_KEY, raw);
        const result = saveGame({
            gameMode: 'PvP', moves: ['h2e2'],
            moveTree: Array.from({ length: 1024 }, () => ({ uci: 'h2e2', comment: 'x'.repeat(500) })),
        });
        expect(result).toBeNull();
        expect(store.get(GAME_LIBRARY_STORAGE_KEY)).toBe(raw);
        expect(loadAllGames()).toHaveLength(400);
    });

    it('does not overwrite a library with unreadable JSON', () => {
        store.set(GAME_LIBRARY_STORAGE_KEY, '{truncated');
        expect(save(['h2e2'])).toBeNull();
        expect(deleteGame('old')).toBe(false);
        expect(renameGame('old', 'New title')).toBe(false);
        expect(store.get(GAME_LIBRARY_STORAGE_KEY)).toBe('{truncated');
    });
});


it('preserves legacy records rejected by stricter setup validation', () => {
    const raw = JSON.stringify([{ id: 'legacy', savedAt: 1, gameMode: 'PvP', moves: [],
        startFen: '3k5/9/9/9/9/9/9/9/R8/R3K3R w - - 0 1' }]);
    store.set(GAME_LIBRARY_STORAGE_KEY, raw);
    expect(save(['h2e2'])).toBeNull();
    expect(store.get(GAME_LIBRARY_STORAGE_KEY)).toBe(raw);
});

describe('restoreGame', () => {
    /**
     * Undo after deleting a saved study. The record has to come back as
     * itself: `saveGame` mints a fresh id and timestamp, so restoring through
     * it would leave a copy at the top of the list and orphan anything holding
     * the old id -- an open study, a saved review.
     */
    it('puts a deleted game back under its own id and time', () => {
        const saved = saveGame({ gameMode: 'PvP', moves: ['h2e2', 'h9g7'], label: 'Kept' })!;
        expect(saved).not.toBeNull();
        expect(deleteGame(saved.id)).toBe(true);
        expect(loadAllGames()).toHaveLength(0);

        expect(restoreGame(saved)).toBe(true);
        const back = loadAllGames();
        expect(back).toHaveLength(1);
        expect(back[0].id).toBe(saved.id);
        expect(back[0].savedAt).toBe(saved.savedAt);
        expect(back[0].label).toBe('Kept');
        expect(back[0].moves).toEqual(['h2e2', 'h9g7']);
    });

    it('is safe to press twice', () => {
        const saved = saveGame({ gameMode: 'PvP', moves: ['h2e2'] })!;
        deleteGame(saved.id);
        expect(restoreGame(saved)).toBe(true);
        expect(restoreGame(saved)).toBe(true);
        expect(loadAllGames()).toHaveLength(1);
    });

    it('will not write over a library it cannot read', () => {
        // `mutationBlocked`: the stored value is not a library, so the games in
        // it are unknown. Restoring by rewriting the whole array would throw
        // away whatever is actually in there -- which is the situation the
        // reader is being told to download a recovery file from.
        const saved = saveGame({ gameMode: 'PvP', moves: ['h2e2'] })!;
        store.set(GAME_LIBRARY_STORAGE_KEY, '{ this is not a library');
        expect(restoreGame(saved)).toBe(false);
        expect(store.get(GAME_LIBRARY_STORAGE_KEY)).toBe('{ this is not a library');
    });

    it('refuses a record the library would not have accepted in the first place', () => {
        // Same door as every other write: an undo must not be a way to put
        // something unreadable into the library.
        expect(restoreGame({ id: 'x', savedAt: 1, gameMode: 'PvP', moves: ['nonsense'] } as never)).toBe(false);
        expect(loadAllGames()).toHaveLength(0);
    });
});
