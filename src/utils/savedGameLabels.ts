import type { SavedGame } from './gameLibrary';
import type { HistoricalGame } from './historicalGames';

/**
 * The badge on a game's card.
 *
 * A saved game's `result` is optional and `normalizeSavedGame` drops one it
 * does not recognise, so the missing case is reachable -- and it used to fall
 * through to "Draw", labelling a game with a result it never had. The chain
 * read as though every case was covered because historical games, which share
 * this function, always carry one.
 */
export function resultLabel(result: HistoricalGame['result'] | SavedGame['result']): string {
    if (result === 'red') return 'Red wins';
    if (result === 'black') return 'Black wins';
    if (result === 'draw') return 'Draw';
    if (result === 'ongoing') return 'Ongoing';
    return 'No result';
}
