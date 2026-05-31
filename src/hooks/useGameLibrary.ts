import { useCallback, useState } from 'react';
import { loadAllGames, saveGame, deleteGame, renameGame } from '../utils/gameLibrary';
import type { SavedGame } from '../utils/gameLibrary';
import type { GameMode } from '../App';

export function useGameLibrary() {
    const [games, setGames] = useState<SavedGame[]>(() => loadAllGames());

    const refresh = useCallback(() => {
        setGames(loadAllGames());
    }, []);

    const save = useCallback((
        gameMode: GameMode,
        moves: string[],
        options: {
            opening?: string;
            finalEval?: number;
            label?: string;
            startFen?: string;
            result?: SavedGame['result'];
            review?: SavedGame['review'];
        } = {}
    ): SavedGame | null => {
        const saved = saveGame({
            gameMode,
            ...options,
            moves,
            result: options.result ?? 'ongoing',
        });
        if (saved) {
            setGames(loadAllGames());
        }
        return saved;
    }, []);

    const remove = useCallback((id: string): boolean => {
        const ok = deleteGame(id);
        setGames(loadAllGames());
        return ok;
    }, []);

    const rename = useCallback((id: string, label: string): boolean => {
        const ok = renameGame(id, label);
        setGames(loadAllGames());
        return ok;
    }, []);

    return { games, save, remove, rename, refresh };
}
