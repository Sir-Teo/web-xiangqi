import { expect, it, vi } from 'vitest';
import { AUTO_SAVE_DRAFT_PREFIX, clearAutoSaveDraft, readAutoSaveDraftRaw, readAutoSaveDrafts, readRecoveryState, writeAutoSaveDraft } from './autoSaveDrafts';
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
    expect(readRecoveryState(storage).problems[0].raw).toBe(raw);
    writeAutoSaveDraft(game, storage, 2, 'new-tab');
    expect(readAutoSaveDraftRaw('legacy', storage)).toBe(raw);
    expect(readRecoveryState(storage).problems[0].raw).toBe(raw);
    expect(readAutoSaveDrafts(storage).map(draft => draft.draftId)).toEqual(['new-tab']);
});

it('parses a mirrored draft once per scan and sees changes on the next scan', () => {
    const storage = storageFixture();
    writeAutoSaveDraft(game, storage, 1, 'tab-a');
    const parse = vi.spyOn(JSON, 'parse');
    try {
        const state = readRecoveryState(storage);
        expect(state.drafts.map(draft => draft.draftId)).toEqual(['tab-a']);
        expect(state.problems).toEqual([]);
        expect(parse).toHaveBeenCalledTimes(1);
    } finally { parse.mockRestore(); }
    writeAutoSaveDraft({ ...game, rootComment: 'Changed by the other tab' }, storage, 2, 'tab-a');
    expect(readRecoveryState(storage).drafts[0].game.rootComment).toBe('Changed by the other tab');
    clearAutoSaveDraft('tab-a', storage);
    expect(readRecoveryState(storage)).toEqual({ drafts: [], problems: [] });
});

it('keeps readable drafts and every damaged source in one scan', () => {
    const storage = storageFixture();
    writeAutoSaveDraft(game, storage, 1, 'tab-a');
    writeAutoSaveDraft({ ...game, rootComment: 'Newest' }, storage, 2, 'tab-b');
    storage.setItem(AUTO_SAVE_DRAFT_PREFIX + 'damaged', '{bad owned draft');
    storage.setItem(AUTO_SAVED_GAME_KEY, '{bad legacy mirror');
    const state = readRecoveryState(storage);
    expect(state.drafts.map(draft => draft.draftId)).toEqual(['tab-b', 'tab-a']);
    expect(state.problems.map(({ draftId, raw }) => ({ draftId, raw }))).toEqual([
        { draftId: 'legacy', raw: '{bad legacy mirror' },
        { draftId: 'damaged', raw: '{bad owned draft' },
    ]);
    expect(storage.getItem(AUTO_SAVE_DRAFT_PREFIX + 'damaged')).toBe('{bad owned draft');
    expect(storage.getItem(AUTO_SAVED_GAME_KEY)).toBe('{bad legacy mirror');
});

it('retains a legacy draft even when slot enumeration is blocked or its owner is malformed', () => {
    const storage = storageFixture();
    storage.setItem(AUTO_SAVED_GAME_KEY, JSON.stringify({ version: 1, savedAt: 1,
        draftId: { invalid: true }, game: { ...game, id: 'legacy', savedAt: 1 } }));
    Object.defineProperty(storage, 'length', { get() { throw new Error('Blocked enumeration'); } });
    expect(readRecoveryState(storage).drafts.map(draft => draft.draftId)).toEqual(['legacy']);
    expect(readRecoveryState(null)).toEqual({ drafts: [], problems: [] });
});
