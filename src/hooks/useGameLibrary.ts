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
        options: { opening?: string; finalEval?: number; label?: string } = {}
    ): SavedGame => {
        const saved = saveGame({
            gameMode,
            moves,
            result: 'ongoing',
            ...options,
        });
        setGames(loadAllGames());
        return saved;
    }, []);

    const remove = useCallback((id: string) => {
        deleteGame(id);
        setGames(loadAllGames());
    }, []);

    const rename = useCallback((id: string, label: string) => {
        renameGame(id, label);
        setGames(loadAllGames());
    }, []);

    return { games, save, remove, rename, refresh };
}
