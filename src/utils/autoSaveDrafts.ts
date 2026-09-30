import { AUTO_SAVED_GAME_KEY, readAutoSavedGame, writeAutoSavedGame, type AutoSaveInput, type AutoSavedGame } from './autoSave';
import { getLocalStorage, readStorage, removeStorage, writeStorage, type KeyValueStorage } from './storage';

export const AUTO_SAVE_DRAFT_PREFIX = 'xiangqi:recovery-draft:v1:';
// A document owns its slot. Duplicating a tab must not duplicate ownership.
export const currentDraftId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
export type RecoveryDraft = AutoSavedGame & { draftId: string };

function draftStorage(id: string, storage: KeyValueStorage): KeyValueStorage {
    const key = AUTO_SAVE_DRAFT_PREFIX + id;
    return {
        getItem: name => name === AUTO_SAVED_GAME_KEY ? storage.getItem(key) : null,
        setItem: (_name, value) => {
            const serialized = JSON.stringify({ ...JSON.parse(value), draftId: id });
            storage.setItem(key, serialized);
            // Compatibility mirror for older app versions. Recovery always uses
            // the independent slots, so another tab replacing this is harmless.
            writeStorage(AUTO_SAVED_GAME_KEY, serialized, storage);
        },
        removeItem: () => clearAutoSaveDraft(id, storage),
    };
}

export function clearAutoSaveDraft(id: string, storage = getLocalStorage()): void {
    if (!storage) return;
    if (id === 'legacy') { removeStorage(AUTO_SAVED_GAME_KEY, storage); return; }
    removeStorage(AUTO_SAVE_DRAFT_PREFIX + id, storage);
    try {
        if (JSON.parse(readStorage(AUTO_SAVED_GAME_KEY, storage) ?? 'null')?.draftId === id) {
            removeStorage(AUTO_SAVED_GAME_KEY, storage);
        }
    } catch { /* A malformed legacy copy is kept for recovery. */ }
}

export function readAutoSaveDrafts(storage = getLocalStorage()): RecoveryDraft[] {
    if (!storage) return [];
    const drafts: RecoveryDraft[] = [];
    const enumerable = storage as Partial<Storage>;
    try {
        for (let i = 0; i < (enumerable.length ?? 0); i++) {
            const key = enumerable.key?.(i);
            if (!key?.startsWith(AUTO_SAVE_DRAFT_PREFIX)) continue;
            const draftId = key.slice(AUTO_SAVE_DRAFT_PREFIX.length);
            const snapshot = readAutoSavedGame(draftStorage(draftId, storage));
            if (snapshot) drafts.push({ ...snapshot, draftId });
        }
    } catch { /* The legacy reader below still works with restricted storage. */ }
    const legacy = readAutoSavedGame(storage);
    if (legacy) {
        let id = 'legacy';
        try { id = JSON.parse(readStorage(AUTO_SAVED_GAME_KEY, storage)!).draftId ?? id; } catch { /* Legacy envelope. */ }
        if (!drafts.some(draft => draft.draftId === id)) drafts.push({ ...legacy, draftId: id });
    }
    return drafts.sort((a, b) => b.savedAt - a.savedAt);
}

export function writeAutoSaveDraft(game: AutoSaveInput, storage = getLocalStorage(), savedAt = Date.now(), id: string = currentDraftId) {
    return writeAutoSavedGame(game, storage ? draftStorage(id, storage) : null, savedAt);
}
