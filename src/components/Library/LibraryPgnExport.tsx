import { useLayoutEffect, useRef, useState } from 'react';
import type { SavedGame } from '../../utils/gameLibrary';
import { downloadTextFile } from '../../utils/gameExport';
import { packCollectionGames } from '../../utils/moveTreeTransfer';
import { pgnDownloadFilename } from '../../utils/pgnFilename';
import { savedGamePgnInput } from '../../utils/savedGamePgn';

export function LibraryPgnExport({ games, preparing }: { games: SavedGame[]; preparing: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  function stop() {
    worker.current?.terminate(); worker.current = null;
    clearTimeout(timeout.current);
  }
  useLayoutEffect(() => {
    // Commit a changed result set before a queued old worker reply can download it.
    const canceled = worker.current !== null;
    generation.current++; stop(); setBusy(false); setMessage(canceled ? 'PGN export canceled because matching games changed.' : ''); setError('');
  }, [games, preparing]);
  useLayoutEffect(() => () => { generation.current++; stop(); }, []);
  useLayoutEffect(() => {
    if (busy) {
      if (restoreFocus.current && (document.activeElement === document.body || document.activeElement === trigger.current)) {
        cancelButton.current?.focus();
      }
      return;
    }
    if (restoreFocus.current && document.activeElement === document.body) trigger.current?.focus();
    restoreFocus.current = false;
  }, [busy]);

  function finish() {
    generation.current++;
    if (document.activeElement === cancelButton.current) restoreFocus.current = true;
    stop(); setBusy(false);
  }
  function start() {
    if (worker.current || preparing || !games.length) return;
    const request = ++generation.current;
    restoreFocus.current = document.activeElement === trigger.current;
    setBusy(true); setMessage(''); setError('');
    const fail = (message: string) => {
      if (request !== generation.current) return;
      finish(); setError(message);
    };
    try {
      const exporter = new Worker(new URL('../../workers/pgnExport.worker.ts', import.meta.url), { type: 'module' });
      worker.current = exporter;
      exporter.onerror = event => {
        event.preventDefault();
        fail('The PGN exporter could not start. Try again, or download individual game files.');
      };
      exporter.onmessageerror = () => fail('The PGN exporter returned an unreadable response. Please try again.');
      exporter.onmessage = (event: MessageEvent<{ pgn?: string; count?: number; error?: string }>) => {
        if (request !== generation.current) return;
        const data = event.data;
        if (typeof data?.error === 'string' && data.error) { fail(data.error); return; }
        if (!data || typeof data.pgn !== 'string' || !data.pgn || data.count !== games.length) {
          fail('The complete PGN collection could not be prepared. Nothing was downloaded. Please try again.'); return;
        }
        const downloaded = downloadTextFile(pgnDownloadFilename(`${games.length}-games`), data.pgn, 'application/x-chess-pgn;charset=utf-8');
        finish();
        if (downloaded) setMessage(`Download started for ${games.length} ${games.length === 1 ? 'game' : 'games'}.`);
        else setError('The download could not start. Please try again.');
      };
      timeout.current = setTimeout(() => fail('Preparing this collection took too long. Try again with fewer matching games.'), 30_000);
      // Flat trees cross the worker boundary even for full 1,024-ply studies.
      exporter.postMessage(packCollectionGames(games.map(savedGamePgnInput)));
    } catch {
      fail('The PGN exporter could not start. Try again, or download individual game files.');
    }
  }

  return <section className="lib-transfer lib-collection-export" aria-label="PGN collection export" data-testid="library-pgn-export">
    <details>
      <summary>Export matching games</summary>
      <p>Download every matching saved game in the current sort order, including games on other pages. PGN keeps moves, variations, notes and game details. Use a library backup to keep complete review reports too.</p>
      <div className="lib-transfer-actions">
        <button type="button" ref={trigger} disabled={busy || preparing || !games.length} onClick={start}>
          {busy ? 'Preparing PGN…' : `Download ${games.length} ${games.length === 1 ? 'game' : 'games'} as PGN`}
        </button>
        {busy && <button type="button" ref={cancelButton} onClick={() => {
          finish(); setMessage('PGN export canceled.'); setError('');
        }}>Cancel export</button>}
      </div>
      {error && <p className="lib-action-error" role="alert">{error}</p>}
      <p className="lib-transfer-status" role="status" aria-atomic="true">{busy
        ? `Preparing ${games.length} matching ${games.length === 1 ? 'game' : 'games'}…`
        : preparing ? 'Preparing library search…' : !games.length ? 'No matching saved games to export.' : message}</p>
    </details>
  </section>;
}
