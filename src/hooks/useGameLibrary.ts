import { withLibraryMutation, LIBRARY_LOCK_ERROR } from '../utils/libraryMutation';
import { useCallback, useEffect, useState } from 'react';
import { GAME_LIBRARY_STORAGE_KEY, loadLibraryState, saveGameWithResult, updateSavedGameWithResult, deleteGame, renameGame, restoreGame } from '../utils/gameLibrary';
import type { SavedGame } from '../utils/gameLibrary';
import type { GameMode } from '../App';

export function useGameLibrary() {
    const [saveError, setSaveError] = useState<string | null>(null);
    const [libraryState, setLibraryState] = useState(loadLibraryState);

    const refresh = useCallback(() => {
        setLibraryState(loadLibraryState());
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onStorage = (event: StorageEvent) => {
            if (event.storageArea && event.storageArea !== window.localStorage) return;
            if (event.key !== GAME_LIBRARY_STORAGE_KEY && event.key !== null) return;
            refresh();
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [refresh]);

    const save = useCallback(async (
        gameMode: GameMode,
        moves: string[],
        options: {
            metadata?: SavedGame['metadata'];
            opening?: string;
            finalEval?: number;
            finalEvalKind?: SavedGame['finalEvalKind'];
            label?: string;
            startFen?: string;
            result?: SavedGame['result'];
            moveTree?: SavedGame['moveTree'];
            review?: SavedGame['review'];
        } = {}
    ): Promise<SavedGame | null> => {
        const result = await withLibraryMutation(() => saveGameWithResult({
            gameMode,
            ...options,
            moves,
            result: options.result ?? 'ongoing',
        }), { game: null, error: LIBRARY_LOCK_ERROR });
        setSaveError(result.error);
        if (result.game) setLibraryState(loadLibraryState());
        return result.game;
    }, []);

    const remove = useCallback(async (id: string): Promise<boolean> => {
        const ok = await withLibraryMutation(() => deleteGame(id), false);
        setLibraryState(loadLibraryState());
        return ok;
    }, []);

    const restore = useCallback(async (game: SavedGame): Promise<boolean> => {
        const ok = await withLibraryMutation(() => restoreGame(game), false);
        setLibraryState(loadLibraryState());
        return ok;
    }, []);

    const update = useCallback(async (source: SavedGame, replacement: Omit<SavedGame, 'id' | 'savedAt'>): Promise<SavedGame | null> => {
        const result = await withLibraryMutation(() => updateSavedGameWithResult(source, replacement), { game: null, error: LIBRARY_LOCK_ERROR });
        setSaveError(result.error);
        setLibraryState(loadLibraryState());
        return result.game;
    }, []);

    const rename = useCallback(async (id: string, label: string): Promise<boolean> => {
        const ok = await withLibraryMutation(() => renameGame(id, label), false);
        setLibraryState(loadLibraryState());
        return ok;
    }, []);

    return { games: libraryState.games, libraryState, save, update, saveError, remove, restore, rename, refresh };
}
