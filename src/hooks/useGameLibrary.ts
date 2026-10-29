import { withLibraryMutation, LIBRARY_LOCK_ERROR } from '../utils/libraryMutation';
import { migratePracticeProgressRevision } from '../utils/practiceProgressStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adoptLibraryState, initialLibraryState, type LibraryState } from '../utils/gameLibrary';
import { readLibraryInWorker } from '../utils/libraryRead';
import { GAME_LIBRARY_STORAGE_KEY, loadLibraryState, saveGameWithResult, updateSavedGameWithResult, deleteGame, renameGame, restoreGame } from '../utils/gameLibrary';
import type { SavedGame } from '../utils/gameLibrary';
import type { GameMode } from '../utils/gameModes';

export function useGameLibrary() {
    const [saveError, setSaveError] = useState<string | null>(null);
    const [initial, setInitial] = useState<ReturnType<typeof initialLibraryState> | null>(initialLibraryState);
    const [libraryState, setLibraryState] = useState(() => initial!.state);
    const [loading, setLoading] = useState(() => Boolean(initial?.pendingRaw));
    const generation = useRef(0);
    const publish = useCallback((state: LibraryState) => { generation.current++; setLibraryState(state); setLoading(false); setInitial(null); }, []);
    useEffect(() => {
        if (!initial?.pendingRaw) return;
        const controller = new AbortController();
        const token = ++generation.current;
        void readLibraryInWorker(initial.pendingRaw, controller.signal).then(result => {
            if (!controller.signal.aborted && token === generation.current) publish(adoptLibraryState(initial.pendingRaw!, result));
        }).catch(() => {
            if (!controller.signal.aborted && token === generation.current) publish(loadLibraryState());
        });
        return () => controller.abort();
    }, [initial, publish]);

    const refresh = useCallback(() => {
        publish(loadLibraryState());
    }, [publish]);

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
        if (result.game) publish(loadLibraryState());
        return result.game;
    }, [publish]);

    const remove = useCallback(async (id: string): Promise<boolean> => {
        const ok = await withLibraryMutation(() => deleteGame(id), false);
        publish(loadLibraryState());
        return ok;
    }, [publish]);

    const restore = useCallback(async (game: SavedGame): Promise<boolean> => {
        const ok = await withLibraryMutation(() => restoreGame(game), false);
        publish(loadLibraryState());
        return ok;
    }, [publish]);

    const update = useCallback(async (source: SavedGame, replacement: Omit<SavedGame, 'id' | 'savedAt'>): Promise<SavedGame | null> => {
        const result = await withLibraryMutation(() => {
            migratePracticeProgressRevision(source);
            return updateSavedGameWithResult(source, replacement);
        }, { game: null, error: LIBRARY_LOCK_ERROR });
        setSaveError(result.error);
        publish(loadLibraryState());
        return result.game;
    }, [publish]);

    const rename = useCallback(async (id: string, label: string): Promise<boolean> => {
        const ok = await withLibraryMutation(() => renameGame(id, label), false);
        publish(loadLibraryState());
        return ok;
    }, [publish]);

    return { games: libraryState.games, libraryState, loading, save, update, saveError, remove, restore, rename, refresh };
}
