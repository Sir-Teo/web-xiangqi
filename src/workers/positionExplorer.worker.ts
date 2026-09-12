import { buildLibraryPositionIndex, lookupLibraryPosition, selectLibraryPositionGames, type LibraryPositionReport } from '../utils/positionExplorer';
import type { SavedGame } from '../utils/gameLibrary';
import type { BoardState, Side } from '../utils/xiangqi';
import { positionKey } from '../utils/repetition';

export type ExplorerRequest =
  | { type: 'build'; games: SavedGame[] }
  | { type: 'lookup'; requestId: number; board: BoardState; side: Side };

export type ExplorerReply = { requestId: number; key: string; report: LibraryPositionReport; skipped: number };

let index: ReturnType<typeof buildLibraryPositionIndex> | null = null;
// Keep only compact reports (eight game links), not another copy of every
// occurrence. Bound memory when a study visits many different positions.
const recentReports = new Map<string, LibraryPositionReport>();
const MAX_RECENT_REPORTS = 128;
self.onmessage = ({ data }: MessageEvent<ExplorerRequest>) => {
  if (data.type === 'build') {
    index = buildLibraryPositionIndex(data.games);
    recentReports.clear();
    return;
  }
  // Keep the potentially large index in this worker; transfer only the current
  // position's report and a bounded selection of matching games.
  const key = positionKey(data.board, data.side);
  let report = recentReports.get(key);
  if (report) {
    recentReports.delete(key); // Refresh recency when navigating back and forth.
  } else {
    const { hits, ...summary } = lookupLibraryPosition(index, data.board, data.side);
    report = { ...summary, hits: selectLibraryPositionGames(hits) };
  }
  recentReports.set(key, report);
  if (recentReports.size > MAX_RECENT_REPORTS) recentReports.delete(recentReports.keys().next().value!);
  self.postMessage({ requestId: data.requestId, key, report, skipped: index?.skipped ?? 0 });
};
