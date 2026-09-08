import { useCallback, useEffect, useState } from 'react';
import { GAME_LIBRARY_STORAGE_KEY, loadLibraryState, saveGameWithResult, deleteGame, renameGame } from '../utils/gameLibrary';
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

    const save = useCallback((
        gameMode: GameMode,
        moves: string[],
        options: {
            metadata?: SavedGame['metadata'];
            opening?: string;
            finalEval?: number;
            label?: string;
            startFen?: string;
            result?: SavedGame['result'];
            moveTree?: SavedGame['moveTree'];
            review?: SavedGame['review'];
        } = {}
    ): SavedGame | null => {
        const result = saveGameWithResult({
            gameMode,
            ...options,
            moves,
            result: options.result ?? 'ongoing',
        });
        setSaveError(result.error);
        if (result.game) setLibraryState(loadLibraryState());
        return result.game;
    }, []);

    const remove = useCallback((id: string): boolean => {
        const ok = deleteGame(id);
        setLibraryState(loadLibraryState());
        return ok;
    }, []);

    const rename = useCallback((id: string, label: string): boolean => {
        const ok = renameGame(id, label);
        setLibraryState(loadLibraryState());
        return ok;
    }, []);

    return { games: libraryState.games, libraryState, save, saveError, remove, rename, refresh };
}
