import { expect, it } from 'vitest';
import { librarySource, resolveLibrarySource } from './librarySource';
import { readAutoSavedGame, writeAutoSavedGame } from './autoSave';
import type { SavedGame } from './gameLibrary';
const game: SavedGame = { id: 'study', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'] };
it('restores source identity across normalization and independent renames', () => {
    const source = librarySource(game);
    const renamed = { ...game, label: 'New label' };
    expect(resolveLibrarySource(source, [renamed])).toBe(renamed);
    expect(resolveLibrarySource(source, [{ ...game, moves: ['b2e2'] }])).toBeNull();
    expect(resolveLibrarySource(source, [])).toBeNull();
});
it('keeps the library source separate from the recovered game record', () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
    const sourceLibrary = librarySource(game);
    writeAutoSavedGame({ ...game, moves: ['h2e2', 'h9g7'], sourceLibrary }, storage, 2);
    const draft = readAutoSavedGame(storage)!;
    expect(draft.sourceLibrary).toEqual(sourceLibrary);
    expect(draft.game).not.toHaveProperty('sourceLibrary');
    expect(resolveLibrarySource(draft.sourceLibrary, [game])).toBe(game);
});
