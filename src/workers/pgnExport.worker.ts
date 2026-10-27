import { unpackCollectionGames, type PackedGame } from '../utils/moveTreeTransfer';
import { exportPgnCollection } from '../utils/pgnCollectionExport';
import type { SavedGamePgnInput } from '../utils/savedGamePgn';

self.onmessage = (event: MessageEvent<PackedGame<SavedGamePgnInput>[]>) => {
  try {
    const games = unpackCollectionGames(event.data);
    self.postMessage({ pgn: exportPgnCollection(games), count: games.length });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not prepare this PGN collection. Please try again.' });
  }
};
