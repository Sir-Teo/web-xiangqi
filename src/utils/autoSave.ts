import { type KeyValueStorage, getLocalStorage, removeStorage, writeStorage } from './storage';

/**
 * Keeps the game in progress somewhere it survives a reload or a crash, so a
 * long analysis is not lost to a stray refresh. Separate from the library:
 * this is one slot, overwritten constantly, and the reader never asked for it.
 *
 * The payload is a SavedGame, so reading it back reuses normalizeSavedGame and
 * inherits every cap and validation the library already applies.
 */

import { MAX_SAVED_MOVES, MAX_SAVED_TREE_NODES, type SavedGame, normalizeSavedGame } from './gameLibrary';
import { AUTO_SAVED_GAME_KEY, readVersionedStorage } from './storageKeys';

export { AUTO_SAVED_GAME_KEY };
export const AUTO_SAVE_MAX_BYTES = 2 * 1024 * 1024;
export const AUTO_SAVE_MAX_LABEL = '2 MB';
/** Fixed, because there is only ever one auto-save. */
export const AUTO_SAVE_ID = 'auto-save';

export type AutoSaveInput = Omit<SavedGame, 'id' | 'savedAt'>;
export type AutoSavedGame = { version: 1; savedAt: number; game: SavedGame };
export type AutoSaveWriteResult = 'saved' | 'too-large' | 'empty' | 'failed';

type AutoSaveStorage = KeyValueStorage;

function exceedsRecoveryMoveLimit(game: AutoSaveInput): boolean {
    if (game.moves.length > MAX_SAVED_MOVES) return true;
    const pending = [game.moveTree ?? []];
    let nodes = 0;
    while (pending.length) {
        const siblings = pending.pop()!;
        nodes += siblings.length;
        if (nodes > MAX_SAVED_TREE_NODES) return true;
        for (const node of siblings) if (node.children?.length) pending.push(node.children);
    }
    return false;
}

function getSerializedByteLength(value: string): number {
    try {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
    } catch {
        // Fall back to the UTF-16 length when TextEncoder is blocked.
    }
    return value.length;
}

/** A fresh board is not worth restoring, and offering to would only annoy. */
export function isWorthAutoSaving(game: AutoSaveInput): boolean {
    if (game.moves.length > 0) return true;
    if (game.moveTree?.length) return true;
    return Boolean(game.startFen || game.rootComment?.trim());
}

export function readAutoSavedGame(
    storage: AutoSaveStorage | null = getLocalStorage()
): AutoSavedGame | null {
    if (!storage) return null;
    try {
        const raw = readVersionedStorage(AUTO_SAVED_GAME_KEY, storage);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<AutoSavedGame> | null;
        if (!parsed || parsed.version !== 1) return null;
        if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return null;

        const game = normalizeSavedGame(parsed.game);
        if (!game) return null;
        return { version: 1, savedAt: parsed.savedAt, game };
    } catch {
        return null;
    }
}

export function writeAutoSavedGame(
    game: AutoSaveInput,
    storage: AutoSaveStorage | null = getLocalStorage(),
    savedAt = Date.now()
): AutoSaveWriteResult {
    if (!storage) return 'failed';
    if (!isWorthAutoSaving(game)) {
        clearAutoSavedGame(storage);
        return 'empty';
    }

    try {
        // The byte ceiling alone permits thousands of moves that the reader
        // rejects. Report the capacity problem while the study is still open.
        if (exceedsRecoveryMoveLimit(game)) {
            clearAutoSavedGame(storage);
            return 'too-large';
        }
        const snapshot: AutoSavedGame = {
            version: 1,
            savedAt,
            game: { ...game, id: AUTO_SAVE_ID, savedAt },
        };
        const serialized = JSON.stringify(snapshot);
        if (getSerializedByteLength(serialized) > AUTO_SAVE_MAX_BYTES) {
            // Better to drop a stale snapshot than to keep offering one that
            // no longer matches the game on screen.
            removeStorage(AUTO_SAVED_GAME_KEY, storage);
            return 'too-large';
        }
        if (!normalizeSavedGame(snapshot.game)) {
            clearAutoSavedGame(storage);
            return 'failed';
        }
        return writeStorage(AUTO_SAVED_GAME_KEY, serialized, storage) ? 'saved' : 'failed';
    } catch {
        return 'failed';
    }
}

export function clearAutoSavedGame(storage: AutoSaveStorage | null = getLocalStorage()): void {
    removeStorage(AUTO_SAVED_GAME_KEY, storage);
}
