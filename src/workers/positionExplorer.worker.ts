import { buildLibraryPositionIndex, lookupLibraryPosition, selectLibraryPositionGames } from '../utils/positionExplorer';
import type { SavedGame } from '../utils/gameLibrary';
import type { BoardState, Side } from '../utils/xiangqi';
import { positionKey } from '../utils/repetition';

export type ExplorerRequest =
  | { type: 'build'; games: SavedGame[] }
  | { type: 'lookup'; board: BoardState; side: Side };

let index: ReturnType<typeof buildLibraryPositionIndex> | null = null;
self.onmessage = ({ data }: MessageEvent<ExplorerRequest>) => {
  if (data.type === 'build') {
    index = buildLibraryPositionIndex(data.games);
    return;
  }
  // Keep the potentially large index in this worker; transfer only the current
  // position's report and a bounded selection of matching games.
  const { hits, ...report } = lookupLibraryPosition(index, data.board, data.side);
  self.postMessage({ key: positionKey(data.board, data.side), report: { ...report, hits: selectLibraryPositionGames(hits) }, skipped: index?.skipped ?? 0 });
};
