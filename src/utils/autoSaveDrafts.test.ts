import { expect, it } from 'vitest';
import { clearAutoSaveDraft, readAutoSaveDraftRaw, readAutoSaveDrafts, readAutoSaveProblems, writeAutoSaveDraft } from './autoSaveDrafts';
import { AUTO_SAVED_GAME_KEY, type AutoSaveInput } from './autoSave';
const game: AutoSaveInput = { gameMode: 'PvP', moves: ['h2e2'] };
function storageFixture() {
    const entries = new Map<string, string>();
    return {
        get length() { return entries.size; },
        key: (index: number) => [...entries.keys()][index] ?? null,
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
        removeItem: (key: string) => { entries.delete(key); },
    };
}
it('keeps independent tab drafts and clears only the selected owner', () => {
    const storage = storageFixture();
    writeAutoSaveDraft(game, storage, 1, 'tab-a');
    writeAutoSaveDraft({ ...game, rootComment: 'Tab B notes' }, storage, 2, 'tab-b');
    expect(readAutoSaveDrafts(storage).map(draft => draft.draftId)).toEqual(['tab-b', 'tab-a']);
    writeAutoSaveDraft({ ...game, moves: [] }, storage, 3, 'tab-a');
    expect(readAutoSaveDrafts(storage).map(draft => draft.draftId)).toEqual(['tab-b']);
    expect(JSON.parse(storage.getItem(AUTO_SAVED_GAME_KEY)!).draftId).toBe('tab-b');
    clearAutoSaveDraft('tab-b', storage);
    expect(readAutoSaveDrafts(storage)).toEqual([]);
});
it('offers legacy snapshots alongside independent drafts without duplicating mirrors', () => {
    const storage = storageFixture();
    writeAutoSaveDraft(game, storage, 1, 'tab-a');
    storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({ version: 1, savedAt: 2, game: { ...game, id: 'auto-save', savedAt: 2 } }));
    expect(readAutoSaveDrafts(storage).map(draft => draft.draftId)).toEqual(['legacy', 'tab-a']);
    clearAutoSaveDraft('legacy', storage);
    expect(readAutoSaveDrafts(storage)).toHaveLength(1);
});

it.each(['{damaged', JSON.stringify({ version: 99, savedAt: 1, game })])('preserves unreadable legacy bytes when another study autosaves', raw => {
    const storage = storageFixture();
    storage.setItem(AUTO_SAVED_GAME_KEY, raw);
    expect(readAutoSaveProblems(storage)[0].raw).toBe(raw);
    writeAutoSaveDraft(game, storage, 2, 'new-tab');
    expect(readAutoSaveDraftRaw('legacy', storage)).toBe(raw);
    expect(readAutoSaveProblems(storage)[0].raw).toBe(raw);
    expect(readAutoSaveDrafts(storage).map(draft => draft.draftId)).toEqual(['new-tab']);
});
