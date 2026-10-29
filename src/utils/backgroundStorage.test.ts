import { afterEach, expect, it, vi } from 'vitest';
import { adoptLibraryState, GAME_LIBRARY_STORAGE_KEY, initialLibraryState, loadLibraryState, parseLibraryState } from './gameLibrary';
import { commitPreparedAutoSave, prepareAutoSavedGame, readAutoSavedGame, writeAutoSavedGame, type AutoSaveInput } from './autoSave';
import { prepareAutoSaveInWorker, shouldPrepareAutoSaveInWorker } from './autoSaveWorker';
import { packCollectionGames, unpackCollectionGames } from './moveTreeTransfer';

afterEach(() => vi.unstubAllGlobals());
const game: AutoSaveInput = { gameMode: 'PvP', moves: ['h2e2'], result: 'ongoing', rootComment: 'Annotated study', moveTree: [{ uci: 'h2e2', comment: 'Cannon plan', children: [{ uci: 'h9g7', comment: 'Horse' }] }] };
function storage() {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
it('prepares exactly the same durable snapshot as a synchronous save and rechecks actual bytes', () => {
    const sync = storage(), background = storage();
    expect(writeAutoSavedGame(game, sync, 123)).toBe('saved');
    const prepared = prepareAutoSavedGame(game, 123);
    expect(commitPreparedAutoSave(prepared, background)).toBe('saved');
    expect(background.getItem('xiangqi:auto-saved-game:v1')).toBe(sync.getItem('xiangqi:auto-saved-game:v1'));
    expect(readAutoSavedGame(background)?.game.moveTree?.[0].children?.[0].comment).toBe('Horse');
    background.removeItem('xiangqi:auto-saved-game:v1');
    expect(commitPreparedAutoSave(prepared, background)).toBe('saved');
    expect(readAutoSavedGame(background)).not.toBeNull();
    expect(commitPreparedAutoSave(prepareAutoSavedGame({ gameMode: 'PvP', result: 'ongoing', moves: [] }), background)).toBe('empty');
    expect(readAutoSavedGame(background)).toBeNull();
});
it('defers large library validation and refuses to adopt an obsolete worker result', () => {
    const local = storage(); vi.stubGlobal('localStorage', local);
    const records = Array.from({ length: 150 }, (_, i) => ({ ...game, id: `game-${i}`, savedAt: i, rootComment: 'x'.repeat(600) }));
    const raw = JSON.stringify(records); local.setItem(GAME_LIBRARY_STORAGE_KEY, raw);
    const initial = initialLibraryState();
    expect(initial.pendingRaw).toBe(raw); expect(initial.state.mutationBlocked).toBe(true);
    const result = parseLibraryState(raw);
    expect(result.games.length).toBe(150);
    const adopted = adoptLibraryState(raw, result);
    expect(loadLibraryState()).toBe(adopted);
    local.setItem(GAME_LIBRARY_STORAGE_KEY, JSON.stringify([{ ...records[0], label: 'Newer tab' }]));
    expect(adoptLibraryState(raw, result).games[0].label).toBe('Newer tab');
    local.setItem(GAME_LIBRARY_STORAGE_KEY, '{"unsupported":1}');
    expect(adoptLibraryState(raw, result).mutationBlocked).toBe(true);
    expect(local.getItem(GAME_LIBRARY_STORAGE_KEY)).toBe('{"unsupported":1}');
});
it('retains malformed/duplicate records as blocked library bytes', () => {
    const record = { ...game, id: 'duplicate', savedAt: 1 };
    expect(parseLibraryState(JSON.stringify([record, record])).mutationBlocked).toBe(true);
    expect(parseLibraryState('[{"broken":true}]').mutationBlocked).toBe(true);
});
it('cancels an autosave job without committing its late result', async () => {
    let instance: { terminate: ReturnType<typeof vi.fn> } | undefined;
    vi.stubGlobal('Worker', class {
        terminate = vi.fn(); postMessage = vi.fn();
        constructor() { Object.assign(this, { captured: true }); instance = { terminate: this.terminate }; }
    });
    const controller = new AbortController();
    const result = prepareAutoSaveInWorker(game, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(instance?.terminate).toHaveBeenCalledTimes(1);
});
it('selects background preparation by tree/text size and preserves packed annotations', () => {
    expect(shouldPrepareAutoSaveInWorker(game)).toBe(false);
    expect(shouldPrepareAutoSaveInWorker({ ...game, moveTree: Array.from({ length: 129 }, () => ({ uci: 'h2e2' })) })).toBe(true);
    expect(shouldPrepareAutoSaveInWorker({ ...game, moveTree: [{ uci: 'h2e2', comment: 'a'.repeat(33_000) }] })).toBe(true);
    expect(unpackCollectionGames<AutoSaveInput>(packCollectionGames([game]))).toEqual([game]);
});
