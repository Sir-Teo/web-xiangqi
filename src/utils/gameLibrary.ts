import type { GameMode } from '../App';

const STORAGE_KEY = 'xiangqi-game-library';

export interface SavedGame {
    id: string;
    savedAt: number;
    gameMode: GameMode;
    moves: string[];            // UCI strings from root to leaf
    result?: 'red' | 'black' | 'draw' | 'ongoing';
    label?: string;             // user-editable
    opening?: string;           // matched opening name
    finalEval?: number;
}

function readAll(): SavedGame[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as SavedGame[];
    } catch {
        return [];
    }
}

function writeAll(games: SavedGame[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    } catch {
        console.warn('Game library: localStorage write failed.');
    }
}

export function loadAllGames(): SavedGame[] {
    return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveGame(game: Omit<SavedGame, 'id' | 'savedAt'>): SavedGame {
    const saved: SavedGame = {
        ...game,
        id: crypto.randomUUID(),
        savedAt: Date.now(),
    };
    const games = readAll();
    games.push(saved);
    writeAll(games);
    return saved;
}

export function deleteGame(id: string): void {
    writeAll(readAll().filter((g) => g.id !== id));
}

export function renameGame(id: string, label: string): void {
    const games = readAll().map((g) => g.id === id ? { ...g, label } : g);
    writeAll(games);
}
