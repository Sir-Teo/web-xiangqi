import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedGame } from '../utils/gameLibrary';
import type { LibraryPositionReport } from '../utils/positionExplorer';
import type { BoardState, Side } from '../utils/xiangqi';
import { positionKey } from '../utils/repetition';
import type { ExplorerRequest, ExplorerReply } from '../workers/positionExplorer.worker';

const EMPTY_REPORT: LibraryPositionReport = { games: 0, moves: [], hits: [] };
type Query = { requestId: number; games: SavedGame[]; board: BoardState; side: Side };

/** Reuse the index worker; while busy, keep only the latest library/position query. */
export function useLibraryExplorer(games: SavedGame[], board: BoardState, side: Side) {
  const workerRef = useRef<Worker | null>(null);
  const indexedSourceRef = useRef<SavedGame[] | null>(null);
  const latestRef = useRef<Query | null>(null);
  const pendingRef = useRef<Query | null>(null);
  const inFlightRef = useRef<Query | null>(null);
  const requestIdRef = useRef(0);
  const failedSourceRef = useRef<SavedGame[] | null>(null);
  const [result, setResult] = useState<(ExplorerReply & { source: SavedGame[] }) | null>(null);
  const [failedSource, setFailedSource] = useState<SavedGame[] | null>(null);
  const key = positionKey(board, side);

  const failWorker = useCallback((worker: Worker) => {
    if (workerRef.current !== worker) return;
    workerRef.current = null;
    indexedSourceRef.current = null;
    inFlightRef.current = null;
    pendingRef.current = null;
    failedSourceRef.current = latestRef.current?.games ?? null;
    setFailedSource(failedSourceRef.current);
    setResult(null);
    worker.onmessage = null;
    worker.terminate();
  }, []);

  const dispatch = useCallback(() => {
    const worker = workerRef.current;
    const query = pendingRef.current;
    if (!worker || !query || inFlightRef.current) return;
    pendingRef.current = null;
    inFlightRef.current = query;
    try {
      if (indexedSourceRef.current !== query.games) {
        // Annotations and variation trees are not indexed. Only clone the
        // played line and metadata, and only for the latest pending library.
        const records = query.games.map(({ id, savedAt, gameMode, moves, startFen, result, label, opening }) =>
          ({ id, savedAt, gameMode, moves, startFen, result, label, opening }));
        worker.postMessage({ type: 'build', games: records } satisfies ExplorerRequest);
        indexedSourceRef.current = query.games;
      }
      worker.postMessage({ type: 'lookup', requestId: query.requestId, board: query.board, side: query.side } satisfies ExplorerRequest);
    } catch { failWorker(worker); }
  }, [failWorker]);

  useEffect(() => {
    const query = { requestId: ++requestIdRef.current, games, board, side };
    latestRef.current = query;
    pendingRef.current = query;
    if (!games.length) {
      setResult(null);
      setFailedSource(null);
      failedSourceRef.current = null;
      // A previously created worker receives an empty build to release its
      // index. An empty library at startup needs no worker at all.
      dispatch();
      return;
    }
    if (failedSourceRef.current === games) return;
    if (!workerRef.current) {
      failedSourceRef.current = null;
      setFailedSource(null);
      try {
        const worker = new Worker(new URL('../workers/positionExplorer.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        worker.onmessage = ({ data }: MessageEvent<ExplorerReply>) => {
          if (workerRef.current !== worker) return;
          const completed = inFlightRef.current;
          if (!completed || data?.requestId !== completed.requestId) return;
          inFlightRef.current = null;
          if (latestRef.current === completed) setResult({ ...data, source: completed.games });
          dispatch();
        };
        worker.onerror = event => { event.preventDefault(); failWorker(worker); };
        worker.onmessageerror = () => failWorker(worker);
      } catch {
        failedSourceRef.current = games;
        setFailedSource(games);
        return;
      }
    }
    dispatch();
  }, [games, board, side, dispatch, failWorker]);

  useEffect(() => () => {
    const worker = workerRef.current;
    workerRef.current = null;
    indexedSourceRef.current = null;
    pendingRef.current = null;
    inFlightRef.current = null;
    if (worker) {
      worker.onmessage = null;
      // Keep the error handler to consume late cancellation errors; the
      // worker identity check prevents an abandoned worker updating the UI.
      worker.terminate();
    }
  }, []);

  const current = result?.source === games && result.key === key;
  const status = !games.length ? 'ready' : failedSource === games ? 'error' : current ? 'ready' : 'loading';
  return { report: current ? result.report : EMPTY_REPORT, status, skipped: current ? result.skipped : 0 };
}
