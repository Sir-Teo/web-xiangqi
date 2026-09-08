import { useEffect, useRef, useState } from 'react';
import type { SavedGame } from '../utils/gameLibrary';
import type { LibraryPositionReport } from '../utils/positionExplorer';
import type { BoardState, Side } from '../utils/xiangqi';
import { positionKey } from '../utils/repetition';
import type { ExplorerRequest } from '../workers/positionExplorer.worker';

const EMPTY_REPORT: LibraryPositionReport = { games: 0, moves: [], hits: [] };
type Reply = { key: string; report: LibraryPositionReport; skipped: number };

/** Replay large collections off the UI thread, and never display a stale reply. */
export function useLibraryExplorer(games: SavedGame[], board: BoardState, side: Side) {
  const workerRef = useRef<Worker | null>(null);
  const [result, setResult] = useState<(Reply & { source: SavedGame[] }) | null>(null);
  const [failedSource, setFailedSource] = useState<SavedGame[] | null>(null);
  const key = positionKey(board, side);

  useEffect(() => {
    if (!games.length) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/positionExplorer.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = ({ data }: MessageEvent<Reply>) => setResult({ ...data, source: games });
      worker.onerror = () => { setFailedSource(games); worker.terminate(); };
      worker.onmessageerror = () => { setFailedSource(games); worker.terminate(); };
      // Review trees and annotations can dwarf the played line. They are not
      // indexed, so avoid structured-cloning them into another heap.
      const records = games.map(({ id, savedAt, gameMode, moves, startFen, result, label, opening }) =>
        ({ id, savedAt, gameMode, moves, startFen, result, label, opening }));
      worker.postMessage({ type: 'build', games: records } satisfies ExplorerRequest);
    } catch {
      workerRef.current?.terminate();
      workerRef.current = null;
      setFailedSource(games);
    }
    return () => {
      workerRef.current = null;
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
    };
  }, [games]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: 'lookup', board, side } satisfies ExplorerRequest);
  }, [games, board, side]);

  const current = result?.source === games && result.key === key;
  const status = !games.length ? 'ready' : failedSource === games ? 'error' : current ? 'ready' : 'loading';
  return { report: current ? result.report : EMPTY_REPORT, status, skipped: current ? result.skipped : 0 };
}
