import { AUTO_SAVED_GAME_KEY, commitPreparedAutoSave, parseAutoSaveEnvelope, writeAutoSavedGame, type AutoSaveInput, type AutoSavedGame, type PreparedAutoSave } from './autoSave';
import { readVersionedStorage } from './storageKeys';
import { getLocalStorage, readStorage, removeStorage, writeStorage, type KeyValueStorage } from './storage';

export const AUTO_SAVE_DRAFT_PREFIX = 'xiangqi:recovery-draft:v1:';
// A document owns its slot. Duplicating a tab must not duplicate ownership.
export const currentDraftId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
export type RecoveryDraft = AutoSavedGame & { draftId: string };
const adapters = new WeakMap<KeyValueStorage, Map<string, KeyValueStorage>>();

function draftStorage(id: string, storage: KeyValueStorage): KeyValueStorage {
    let slots = adapters.get(storage);
    if (!slots) { slots = new Map(); adapters.set(storage, slots); }
    const cached = slots.get(id);
    if (cached) return cached;
    const key = AUTO_SAVE_DRAFT_PREFIX + id;
    let knownOwnedMirror: string | null = null;
    const adapter: KeyValueStorage = {
        getItem: name => name === AUTO_SAVED_GAME_KEY ? storage.getItem(key) : null,
        setItem: (_name, value) => {
            // The writer supplies an object envelope. Add ownership without
            // parsing and serializing its entire study a second time.
            const serialized = `{"draftId":${JSON.stringify(id)},${value.slice(1)}`;
            storage.setItem(key, serialized);
            // Compatibility mirror for older app versions. Recovery always uses
            // the independent slots, so another tab replacing this is harmless.
            const previous = readStorage(AUTO_SAVED_GAME_KEY, storage);
            if (previous && previous !== knownOwnedMirror) {
                let owned = false;
                try { owned = Boolean(JSON.parse(previous)?.draftId); } catch { /* Keep malformed data too. */ }
                if (!owned && !readStorage(AUTO_SAVE_DRAFT_PREFIX + 'legacy', storage)
                    && !writeStorage(AUTO_SAVE_DRAFT_PREFIX + 'legacy', previous, storage)) return;
            }
            if (writeStorage(AUTO_SAVED_GAME_KEY, serialized, storage)) knownOwnedMirror = serialized;
        },
        removeItem: () => clearAutoSaveDraft(id, storage),
    };
    slots.set(id, adapter);
    return adapter;
}

export function clearAutoSaveDraft(id: string, storage = getLocalStorage()): void {
    if (!storage) return;
    if (id === 'legacy') {
        removeStorage(AUTO_SAVE_DRAFT_PREFIX + id, storage);
        const raw = readStorage(AUTO_SAVED_GAME_KEY, storage);
        let owned = false;
        try { owned = Boolean(JSON.parse(raw ?? 'null')?.draftId); } catch { /* A raw legacy draft. */ }
        if (!owned) removeStorage(AUTO_SAVED_GAME_KEY, storage);
        return;
    }
    removeStorage(AUTO_SAVE_DRAFT_PREFIX + id, storage);
    try {
        if (JSON.parse(readStorage(AUTO_SAVED_GAME_KEY, storage) ?? 'null')?.draftId === id) {
            removeStorage(AUTO_SAVED_GAME_KEY, storage);
        }
    } catch { /* A malformed legacy copy is kept for recovery. */ }
}

export function readAutoSaveDrafts(storage = getLocalStorage()): RecoveryDraft[] {
    return readRecoveryState(storage).drafts;
}

export type RecoveryProblem = { draftId: string; raw: string; reason: string };
export type RecoveryState = { drafts: RecoveryDraft[]; problems: RecoveryProblem[] };

/** One startup scan; an owned slot and its identical legacy mirror are parsed once. */
export function readRecoveryState(storage = getLocalStorage()): RecoveryState {
    if (!storage) return { drafts: [], problems: [] };
    const legacyRaw = readVersionedStorage(AUTO_SAVED_GAME_KEY, storage);
    const slots: { draftId: string; raw: string }[] = [];
    const drafts: RecoveryDraft[] = [];
    const enumerable = storage as Partial<Storage>;
    try {
        for (let i = 0; i < (enumerable.length ?? 0); i++) {
            const key = enumerable.key?.(i);
            if (!key?.startsWith(AUTO_SAVE_DRAFT_PREFIX)) continue;
            const draftId = key.slice(AUTO_SAVE_DRAFT_PREFIX.length);
            const raw = readStorage(key, storage);
            if (raw) slots.push({ draftId, raw });
        }
    } catch { /* The legacy reader below still works with restricted storage. */ }
    // Local to this scan: a later read must see another tab's changed bytes,
    // and old recovery records should be released when their UI is dismissed.
    const parsed = new Map<string, ReturnType<typeof parseAutoSaveEnvelope>>();
    const parse = (raw: string) => {
        let envelope = parsed.get(raw);
        if (!envelope) { envelope = parseAutoSaveEnvelope(raw); parsed.set(raw, envelope); }
        return envelope;
    };
    for (const { draftId, raw } of slots) {
        const { snapshot } = parse(raw);
        if (snapshot) drafts.push({ ...snapshot, draftId });
    }
    if (legacyRaw) {
        const { snapshot, draftId = 'legacy' } = parse(legacyRaw);
        if (snapshot && !drafts.some(draft => draft.draftId === draftId)) drafts.push({ ...snapshot, draftId });
    }
    const problems = new Map<string, RecoveryProblem>();
    for (const { draftId, raw } of [...(legacyRaw ? [{ draftId: 'legacy', raw: legacyRaw }] : []), ...slots]) {
        if (!parse(raw).snapshot) problems.set(draftId, { draftId, raw, reason: 'This recovery copy has an unsupported format or damaged data.' });
    }
    return { drafts: drafts.sort((a, b) => b.savedAt - a.savedAt), problems: [...problems.values()] };
}

export function writeAutoSaveDraft(game: AutoSaveInput, storage = getLocalStorage(), savedAt = Date.now(), id: string = currentDraftId) {
    return writeAutoSavedGame(game, storage ? draftStorage(id, storage) : null, savedAt);
}

export function commitPreparedAutoSaveDraft(prepared: PreparedAutoSave, storage = getLocalStorage(), id: string = currentDraftId) {
    return commitPreparedAutoSave(prepared, storage ? draftStorage(id, storage) : null);
}

export function readAutoSaveDraftRaw(id: string, storage = getLocalStorage()): string | null {
    return readStorage(AUTO_SAVE_DRAFT_PREFIX + id, storage)
        ?? (id === 'legacy' ? readStorage(AUTO_SAVED_GAME_KEY, storage) : null);
}
