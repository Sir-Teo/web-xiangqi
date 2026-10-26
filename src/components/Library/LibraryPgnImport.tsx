import { withLibraryMutation, LIBRARY_LOCK_ERROR } from '../../utils/libraryMutation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COLLECTION_SIZE_ERROR, MAX_COLLECTION_TEXT_LENGTH, type CollectionGame } from '../../utils/pgnCollection';
import { isSavedGameMode, previewGameCollection, saveGameCollection, type LibraryState } from '../../utils/gameLibrary';
import { resultLabel } from '../../utils/savedGameLabels';
import { formatRatedPlayer } from '../../utils/gameMetadata';
import { matchesSearchTerms, MAX_SEARCH_QUERY_LENGTH, toSearchTerms, toSearchText } from '../../utils/searchTerms';
import { unpackCollectionGames, type PackedGame } from '../../utils/moveTreeTransfer';

const PREVIEW_PAGE_SIZE = 20;

export function LibraryPgnImport({ state, onChange, onOpenGame }: {
  state: LibraryState; onChange: () => void; onOpenGame: (game: CollectionGame) => boolean;
}) {
  const [games, setGames] = useState<CollectionGame[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PREVIEW_PAGE_SIZE);
  const previewList = useRef<HTMLDivElement>(null);
  const nextPageFocus = useRef<number | null>(null);
  const previewPanel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    nextPageFocus.current = null;
    if (previewList.current) previewList.current.scrollTop = 0;
  }, [query, games]);
  useLayoutEffect(() => {
    const index = nextPageFocus.current;
    if (index === null) return;
    nextPageFocus.current = null;
    const control = previewList.current?.children[index]?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)');
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ block: 'nearest' });
  }, [visibleLimit]);
  const indexedGames = useMemo(() => games.map((game, index) => ({
    game, index, text: toSearchText(Object.values(game.metadata ?? {})),
  })), [games]);
  const terms = useMemo(() => toSearchTerms(query), [query]);
  const matchingGames = useMemo(() => indexedGames.filter(entry => matchesSearchTerms(entry.text, terms)), [indexedGames, terms]);
  const hiddenSelected = useMemo(() => selected.size - matchingGames.filter(entry => selected.has(entry.index)).length, [selected, matchingGames]);
  function selectMatches(include: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      for (const { index } of matchingGames) {
        if (include) next.add(index); else next.delete(index);
      }
      return next;
    });
  }
  const preview = useMemo(() => previewGameCollection(games.filter((_, index) => selected.has(index)), state, includeDuplicates), [games, selected, state, includeDuplicates]);
  const [busy, setBusy] = useState(false);
  const readingCancelFocused = useRef(false);
  useLayoutEffect(() => {
    if (busy) return;
    if (readingCancelFocused.current && document.activeElement === document.body) fileInput.current?.focus();
    readingCancelFocused.current = false;
  }, [busy]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const initiatingControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (saving) return;
    const target = initiatingControl.current;
    initiatingControl.current = null;
    // Chromium blurs a focused button as soon as it becomes disabled. On a
    // failed write it is enabled again here; keep it ready for keyboard retry.
    if (target?.isConnected && document.activeElement === document.body) target.focus();
  }, [saving]);
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  function stop() { worker.current?.terminate(); worker.current = null; clearTimeout(timeout.current); }
  useEffect(() => () => { generation.current++; stop(); }, []);

  async function read(file: File | undefined) {
    const id = ++generation.current;
    stop(); setGames([]); setSelected(new Set()); setQuery(''); setVisibleLimit(PREVIEW_PAGE_SIZE); setError(''); setMessage(''); setBusy(false);
    setFileName(file?.name || '');
    if (!file) return;
    if (file.size > MAX_COLLECTION_TEXT_LENGTH * 3) { setError('This file is too large. Split it into smaller PGN files.'); return; }
    setBusy(true);
    try {
      const text = await file.text();
      if (generation.current !== id) return;
      if (text.length > MAX_COLLECTION_TEXT_LENGTH) throw new Error(COLLECTION_SIZE_ERROR);
      const parser = new Worker(new URL('../../workers/pgnCollection.worker.ts', import.meta.url), { type: 'module' });
      worker.current = parser;
      const fail = (message: string) => {
        if (generation.current !== id || worker.current !== parser) return;
        stop(); setBusy(false); setError(message);
      };
      parser.onerror = event => { event.preventDefault(); fail('The collection reader could not start. Please try again.'); };
      parser.onmessageerror = () => fail('The collection reader returned an unreadable response. Please try again.');
      parser.onmessage = (event: MessageEvent<{games?: PackedGame<CollectionGame>[]; error?: string}>) => {
        if (generation.current !== id || worker.current !== parser) return;
        try {
          const data = event.data;
          if (!data || typeof data !== 'object') throw new Error();
          if (typeof data.error === 'string' && data.error) { fail(data.error); return; }
          if (!Array.isArray(data.games)) throw new Error();
          if (!data.games.length) { fail('No games found.'); return; }
          const parsed = unpackCollectionGames(data.games);
          if (parsed.some(game => !game || !Array.isArray(game.moves) || !isSavedGameMode(game.gameMode))) throw new Error();
          stop(); setBusy(false);
          setGames(parsed); setSelected(new Set(parsed.map((_, index) => index)));
        } catch { fail('The collection reader returned an unreadable response. Please try again.'); }
      };
      timeout.current = setTimeout(() => fail('Reading this collection took too long. Split it into smaller files.'), 30_000);
      parser.postMessage(text);
    } catch (error) {
      if (generation.current !== id) return;
      stop(); setBusy(false); setError(error instanceof Error ? error.message : 'The file could not be read.');
    }
  }
  function clearPreview(restoreLostFocus = false) {
    // The focused import/cancel button is about to disappear. Restore a
    // nearby control, but leave focus alone if the user moved elsewhere.
    if (previewPanel.current?.contains(document.activeElement) || (restoreLostFocus && document.activeElement === document.body)) fileInput.current?.focus();
    setGames([]); setSelected(new Set()); setQuery(''); setVisibleLimit(PREVIEW_PAGE_SIZE);
  }
  async function save() {
    if (savingRef.current) return;
    const focused = document.activeElement;
    initiatingControl.current = focused instanceof HTMLElement && previewPanel.current?.contains(focused) ? focused : null;
    const restoreLostFocus = Boolean(initiatingControl.current);
    savingRef.current = true; setSaving(true);
    const request = generation.current;
    // Another tab may hold the lock. Canceling or replacing this file must
    // invalidate the action before it writes, as well as its eventual UI result.
    const result = await withLibraryMutation(() => request === generation.current
      ? saveGameCollection(games.filter((_, index) => selected.has(index)), includeDuplicates)
      : { added: 0, duplicates: 0, error: null }, { added: 0, duplicates: 0, error: LIBRARY_LOCK_ERROR });
    savingRef.current = false; setSaving(false);
    onChange();
    if (request !== generation.current) return;
    setError(result.error || '');
    if (!result.error) { setMessage(`Imported ${result.added} ${result.added === 1 ? 'game' : 'games'}.${result.duplicates ? ` Skipped ${result.duplicates} duplicates.` : ''}`); clearPreview(restoreLostFocus); }
  }

  return <section className="lib-transfer" aria-label="Import PGN collection">
    <details data-testid="pgn-collection-import">
      <summary>Import PGN collection</summary>
      <p>Open a game on the board or add games to your library. Choose a Xiangqi PGN file with coordinate moves, such as h2e2 h9g7.</p>
      <label className="lib-backup-file">Choose PGN collection
        <input ref={fileInput} type="file" accept=".pgn,.txt,text/plain,application/x-chess-pgn"
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void read(file); }} />
      </label>
      {busy && <><p role="status">Checking games and variations…</p><button type="button" onFocus={() => { readingCancelFocused.current = true; }} onClick={() => { generation.current++; stop(); fileInput.current?.focus(); setBusy(false); }}>Cancel reading</button></>}
      {games.length > 0 && <div className="lib-restore-preview" ref={previewPanel}>
        <p><strong className="lib-pgn-filename">{fileName}</strong><br />{games.length} {games.length === 1 ? 'game' : 'games'} checked. Open a game without saving it, or select games to add to your library. Existing saved games will be kept. Identical game content is skipped by default.</p>
        <p>Players, ratings, tournament details, recorded time control, annotator credits, results, variations, notes, evaluations, saved analysis, and supported move-quality marks are retained. Evaluations use Red’s perspective. Run Review to calculate accuracy. Other PGN tags are not retained.</p>
        <label className="lib-pgn-search">Find games in this collection
          <input type="search" value={query} maxLength={MAX_SEARCH_QUERY_LENGTH}
            placeholder="Players, events, dates, annotators…"
            onChange={event => { setQuery(event.target.value); setVisibleLimit(PREVIEW_PAGE_SIZE); }} />
        </label>
        <p role="status">{matchingGames.length} of {games.length} games match{matchingGames.length > visibleLimit ? ` · Showing ${visibleLimit}` : ''}. {selected.size} selected for import.{hiddenSelected > 0 ? ` ${hiddenSelected} selected ${hiddenSelected === 1 ? 'game is' : 'games are'} outside this search.` : ''}</p>
        <div className="lib-transfer-actions">
          <button type="button" disabled={saving || !matchingGames.length} onClick={() => selectMatches(true)}>{terms.length ? 'Select all matches' : 'Select all'}</button>
          <button type="button" disabled={saving || !matchingGames.length} onClick={() => selectMatches(false)}>{terms.length ? 'Deselect matches' : 'Select none'}</button>
          {terms.length > 0 && hiddenSelected > 0 && matchingGames.length > 0 && <button type="button"
            disabled={saving} onClick={() => setSelected(new Set(matchingGames.map(entry => entry.index)))}>Select only matches</button>}
        </div>
        <div className="lib-pgn-games" ref={previewList}>
          {matchingGames.length === 0 && <p>No games match. Try fewer words or clear the search.</p>}
          {matchingGames.slice(0, visibleLimit).map(({ game, index }) => <div key={index} className="lib-pgn-game">
            <label>
            <input type="checkbox" disabled={saving} checked={selected.has(index)} onChange={() => setSelected(previous => {
              const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next;
            })} />
            <span><strong>{index + 1}. {formatRatedPlayer(game.metadata?.redPlayer, game.metadata?.redRating, 'Red')} · {formatRatedPlayer(game.metadata?.blackPlayer, game.metadata?.blackRating, 'Black')}</strong>
              <span>{[game.metadata?.event, game.metadata?.date, game.metadata?.round ? `Round ${game.metadata.round}` : undefined,
                `${game.moves.length} ${game.moves.length === 1 ? 'ply' : 'plies'}`, resultLabel(game.result || 'ongoing')].filter(Boolean).join(' · ')}</span></span>
            </label>
            <button type="button" aria-label={`Open game ${index + 1} on board`}
              onClick={() => { if (!onOpenGame(game)) setError('This game could not be opened because its move data is invalid.'); }}>
              Open on board
            </button>
          </div>)}
        </div>
        {matchingGames.length > visibleLimit && <button type="button"
          onClick={() => { nextPageFocus.current = visibleLimit; setVisibleLimit(value => value + PREVIEW_PAGE_SIZE); }}>Show {Math.min(PREVIEW_PAGE_SIZE, matchingGames.length - visibleLimit)} more games</button>}
        <label><input type="checkbox" disabled={saving} checked={includeDuplicates} onChange={event => setIncludeDuplicates(event.target.checked)} /> Import duplicates as copies</label>
        <p role="status">{preview.added} new games; {preview.duplicates} duplicates skipped.</p>
        {selected.size > 0 && preview.error && <p role="alert">{preview.error}</p>}
        <div className="lib-transfer-actions">
          <button type="button" disabled={saving || state.mutationBlocked || !selected.size || Boolean(preview.error)} onClick={save}>Import {preview.added} {preview.added === 1 ? 'game' : 'games'}</button>
          <button type="button" onClick={() => { generation.current++; stop(); clearPreview(); setError(''); }}>Cancel import</button>
        </div>
      </div>}
      {error && <p className="lib-action-error" role="alert">{error} Nothing was saved.</p>}
      {message && <p role="status">{message}</p>}
    </details>
  </section>;
}
