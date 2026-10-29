import { normalizeLibrarySource, type LibrarySource } from './librarySource';
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
import { normalizeGameMetadata } from './gameMetadata';

export { AUTO_SAVED_GAME_KEY };
export const AUTO_SAVE_MAX_BYTES = 2 * 1024 * 1024;
/** Fixed, because there is only ever one auto-save. */
export const AUTO_SAVE_ID = 'auto-save';

export type AutoSaveInput = Omit<SavedGame, 'id' | 'savedAt'> & { sourceLibrary?: LibrarySource };
export type AutoSavedGame = { version: 1; savedAt: number; game: SavedGame; sourceLibrary?: LibrarySource };
export type AutoSaveWriteResult = 'saved' | 'too-large' | 'empty' | 'failed';

type AutoSaveStorage = KeyValueStorage;
const savedSnapshots = new WeakMap<AutoSaveStorage, { content: string; raw: string }>();

export function exceedsRecoveryMoveLimit(game: AutoSaveInput): boolean {
    if (game.moves.length > MAX_SAVED_MOVES) return true;
    const pending = [{ siblings: game.moveTree ?? [], depth: 1 }];
    let nodes = 0;
    while (pending.length) {
        const { siblings, depth } = pending.pop()!;
        if (siblings.length && depth > MAX_SAVED_MOVES) return true;
        nodes += siblings.length;
        if (nodes > MAX_SAVED_TREE_NODES) return true;
        for (const node of siblings) if (node.children?.length) pending.push({ siblings: node.children, depth: depth + 1 });
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
    return Boolean(game.startFen || game.rootComment?.trim() || game.rootResult || normalizeGameMetadata(game.metadata));
}

export function readAutoSavedGame(
    storage: AutoSaveStorage | null = getLocalStorage()
): AutoSavedGame | null {
    if (!storage) return null;
    const raw = readVersionedStorage(AUTO_SAVED_GAME_KEY, storage);
    return raw ? parseAutoSaveEnvelope(raw).snapshot : null;
}

/** Parse the snapshot and its tab owner together so mirrors need no second JSON read. */
export function parseAutoSaveEnvelope(raw: string): { snapshot: AutoSavedGame | null; draftId?: string } {
    try {
        const parsed = JSON.parse(raw) as (Partial<AutoSavedGame> & { draftId?: unknown }) | null;
        if (!parsed || parsed.version !== 1) return { snapshot: null };
        if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) return { snapshot: null };

        const game = normalizeSavedGame(parsed.game);
        if (!game) return { snapshot: null };
        const sourceLibrary = normalizeLibrarySource(parsed.sourceLibrary);
        return { snapshot: { version: 1, savedAt: parsed.savedAt, game, ...(sourceLibrary ? { sourceLibrary } : {}) },
            ...(typeof parsed.draftId === 'string' && parsed.draftId ? { draftId: parsed.draftId } : {}) };
    } catch {
        return { snapshot: null };
    }
}

export function writeAutoSavedGame(
    game: AutoSaveInput,
    storage: AutoSaveStorage | null = getLocalStorage(),
    savedAt = Date.now()
): AutoSaveWriteResult {
    if (!storage) return 'failed';
    if (!isWorthAutoSaving(game)) { clearAutoSavedGame(storage); return 'empty'; }
    try {
        // Ignore envelope timestamps, but verify the actual slot: deletion or
        // external replacement must be repaired even without a new edit.
        const content = JSON.stringify(game);
        const previous = savedSnapshots.get(storage);
        if (previous?.content === content && storage.getItem(AUTO_SAVED_GAME_KEY) === previous.raw) return 'saved';
        return commitPreparedAutoSave(prepareAutoSavedGame(game, savedAt, content), storage);
    } catch { return 'failed'; }
}

export type PreparedAutoSave = { result: 'ready'; content: string; serialized: string }
    | { result: 'failed' | 'too-large' | 'empty' };

/** Pure preparation also runs in the background worker. Writes stay on the owning tab. */
export function prepareAutoSavedGame(game: AutoSaveInput, savedAt = Date.now(), content?: string): PreparedAutoSave {
    if (!isWorthAutoSaving(game)) return { result: 'empty' };
    try {
        content ??= JSON.stringify(game);
        // The byte ceiling alone permits thousands of moves that the reader
        // rejects. Report the capacity problem while the study is still open.
        if (exceedsRecoveryMoveLimit(game)) {
            return { result: 'too-large' };
        }
        const { sourceLibrary, ...gameData } = game;
        const snapshot: AutoSavedGame = {
            version: 1,
            savedAt,
            game: { ...gameData, id: AUTO_SAVE_ID, savedAt },
            sourceLibrary: normalizeLibrarySource(sourceLibrary),
        };
        const serialized = JSON.stringify(snapshot);
        if (getSerializedByteLength(serialized) > AUTO_SAVE_MAX_BYTES) {
            // Keep the last recoverable snapshot until a newer write succeeds.
            return { result: 'too-large' };
        }
        if (!normalizeSavedGame(snapshot.game)) {
            return { result: 'failed' };
        }
        return { result: 'ready', content, serialized };
    } catch { return { result: 'failed' }; }
}

export function commitPreparedAutoSave(prepared: PreparedAutoSave, storage: AutoSaveStorage | null = getLocalStorage()): AutoSaveWriteResult {
    if (!storage) return 'failed';
    if (prepared.result === 'empty') { clearAutoSavedGame(storage); return 'empty'; }
    if (prepared.result !== 'ready') return prepared.result;
    try {
        const previous = savedSnapshots.get(storage);
        if (previous?.content === prepared.content && storage.getItem(AUTO_SAVED_GAME_KEY) === previous.raw) return 'saved';
        if (!writeStorage(AUTO_SAVED_GAME_KEY, prepared.serialized, storage)) return 'failed';
        const raw = storage.getItem(AUTO_SAVED_GAME_KEY);
        if (raw !== null) savedSnapshots.set(storage, { content: prepared.content, raw });
        return 'saved';
    } catch {
        return 'failed';
    }
}

export function clearAutoSavedGame(storage: AutoSaveStorage | null = getLocalStorage()): void {
    if (storage) savedSnapshots.delete(storage);
    removeStorage(AUTO_SAVED_GAME_KEY, storage);
}
