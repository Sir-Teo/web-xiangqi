import type { SavedGame } from './gameLibrary';
import { downloadTextFile } from './gameExport';

/** Keep a retained record portable even when storage or legal replay refuses it. */
export function downloadRecoveryGame(game: SavedGame, filename: string): boolean {
    try {
        return downloadTextFile(filename, JSON.stringify({
            format: 'web-xiangqi-library', version: 1, games: [game],
        }), 'application/json');
    } catch {
        return false;
    }
}
