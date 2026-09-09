import { useEffect, useRef, useState } from 'react';
import { MAX_COLLECTION_TEXT_LENGTH, type CollectionGame } from '../../utils/pgnCollection';
import { MAX_SAVED_GAMES, saveGameCollection, type LibraryState } from '../../utils/gameLibrary';
import { resultLabel } from '../../utils/savedGameLabels';

export function LibraryPgnImport({ state, onChange }: { state: LibraryState; onChange: () => void }) {
  const [games, setGames] = useState<CollectionGame[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  function stop() { worker.current?.terminate(); worker.current = null; clearTimeout(timeout.current); }
  useEffect(() => () => { generation.current++; stop(); }, []);

  async function read(file: File | undefined) {
    const id = ++generation.current;
    stop(); setGames([]); setSelected(new Set()); setError(''); setMessage(''); setBusy(false);
    setFileName(file?.name || '');
    if (!file) return;
    if (file.size > MAX_COLLECTION_TEXT_LENGTH * 3) { setError('This file is too large. Split it into smaller PGN files.'); return; }
    setBusy(true);
    try {
      const text = await file.text();
      if (generation.current !== id) return;
      if (text.length > MAX_COLLECTION_TEXT_LENGTH) throw new Error('Collection exceeds 1,000,000 characters. Split it into smaller files.');
      const parser = new Worker(new URL('../../workers/pgnCollection.worker.ts', import.meta.url), { type: 'module' });
      worker.current = parser;
      const fail = (message: string) => {
        if (generation.current !== id) return;
        stop(); setBusy(false); setError(message);
      };
      parser.onerror = () => fail('The collection reader could not start. Please try again.');
      parser.onmessageerror = () => fail('The collection reader returned an unreadable response. Please try again.');
      parser.onmessage = (event: MessageEvent<{games?: CollectionGame[]; error?: string}>) => {
        if (generation.current !== id) return;
        stop(); setBusy(false);
        if (event.data.error || !event.data.games?.length) setError(event.data.error || 'No games found.');
        else { setGames(event.data.games); setSelected(new Set(event.data.games.map((_, index) => index))); }
      };
      timeout.current = setTimeout(() => fail('Reading this collection took too long. Split it into smaller files.'), 30_000);
      parser.postMessage(text);
    } catch (error) {
      if (generation.current !== id) return;
      stop(); setBusy(false); setError(error instanceof Error ? error.message : 'The file could not be read.');
    }
  }
  function save() {
    const result = saveGameCollection(games.filter((_, index) => selected.has(index)));
    setError(result.error || '');
    if (!result.error) { setMessage(`Imported ${result.added} ${result.added === 1 ? 'game' : 'games'}.`); setGames([]); setSelected(new Set()); }
    onChange();
  }
  const tooMany = state.games.length + selected.size > MAX_SAVED_GAMES;
  return <section className="lib-transfer" aria-label="Import PGN collection">
    <details data-testid="pgn-collection-import">
      <summary>Import PGN collection</summary>
      <p>Add several games to your library without changing the board. Choose a Xiangqi PGN file with coordinate moves, such as h2e2 h9g7.</p>
      <label className="lib-backup-file">Choose PGN collection
        <input type="file" accept=".pgn,.txt,text/plain,application/x-chess-pgn" disabled={state.mutationBlocked}
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void read(file); }} />
      </label>
      {busy && <><p role="status">Checking games and variations…</p><button type="button" onClick={() => { generation.current++; stop(); setBusy(false); }}>Cancel reading</button></>}
      {games.length > 0 && <div className="lib-restore-preview">
        <p><strong className="lib-pgn-filename">{fileName}</strong><br />{games.length} games checked. Select the games to add. Existing games will be kept; importing the same file again creates new copies.</p>
        <p>Players, tournament details, results, variations, and move notes are retained. Engine annotations are kept as note text, not review scores. Other PGN tags are not retained.</p>
        <div className="lib-transfer-actions">
          <button type="button" onClick={() => setSelected(new Set(games.map((_, index) => index)))}>Select all</button>
          <button type="button" onClick={() => setSelected(new Set())}>Select none</button>
        </div>
        <div className="lib-pgn-games">
          {games.map((game, index) => <label key={index} className="lib-pgn-game">
            <input type="checkbox" checked={selected.has(index)} onChange={() => setSelected(previous => {
              const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next;
            })} />
            <span><strong>{index + 1}. {game.metadata?.redPlayer || 'Red'} · {game.metadata?.blackPlayer || 'Black'}</strong>
              <span>{[game.metadata?.event, game.metadata?.date, game.metadata?.round ? `Round ${game.metadata.round}` : undefined,
                `${game.moves.length} ${game.moves.length === 1 ? 'ply' : 'plies'}`, resultLabel(game.result || 'ongoing')].filter(Boolean).join(' · ')}</span></span>
          </label>)}
        </div>
        {tooMany && <p role="alert">Select fewer games. Your library has {MAX_SAVED_GAMES - state.games.length} spaces remaining.</p>}
        <div className="lib-transfer-actions">
          <button type="button" disabled={state.mutationBlocked || !selected.size || tooMany} onClick={save}>Import {selected.size} {selected.size === 1 ? 'game' : 'games'}</button>
          <button type="button" onClick={() => { generation.current++; stop(); setGames([]); setError(''); }}>Cancel import</button>
        </div>
      </div>}
      {error && <p className="lib-action-error" role="alert">{error} Nothing was saved.</p>}
      {message && <p role="status">{message}</p>}
    </details>
  </section>;
}
