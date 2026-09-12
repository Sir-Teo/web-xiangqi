import { LibraryPgnImport } from './LibraryPgnImport';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { rovingIndexForKey, rovingTabStopIndex } from '../../utils/rovingFocus';
import { LibraryTransfer } from './LibraryTransfer';
import type { LibraryState, SavedGame } from '../../utils/gameLibrary';
import type { HistoricalGame } from '../../utils/historicalGames';
import {
  describeReviewEngineSummary,
  formatAverageCentipawnLoss,
  formatReviewCount,
  formatReviewEngineSummary,
  type ReviewSummary,
} from '../../utils/review';
import { HISTORICAL_GAMES } from '../../utils/historicalGames';
import { formatEvaluationText } from '../../utils/engineEvalReading';
import { matchesSearchTerms, toSearchText, toSearchTerms } from '../../utils/searchTerms';
import { exportPgnFromMoveTree, exportPgnFromUci, copyToClipboard, downloadTextFile } from '../../utils/gameExport';
import { pgnDownloadFilename } from '../../utils/pgnFilename';
import { resultLabel } from '../../utils/savedGameLabels';
import { savedGameLine } from '../../utils/savedGameLine';
import { IconCheck, IconCopy, IconDownload, IconRefresh, IconX } from '../icons';
import './LibraryPanel.css';
import { MAX_SEARCH_QUERY_LENGTH } from '../../utils/searchTerms';
import { evaluationSearchText, savedTreeSearchText } from '../../utils/savedStudySearch';

const SAVED_PAGE_SIZE = 100;
type LibraryPrimaryLine = ReturnType<typeof savedGameLine> & { savedPath: 'complete' | 'prefix' | 'variation' };
type SavedSort = 'recent' | 'oldest' | 'accuracy-high' | 'accuracy-low' | 'average-loss-low' | 'red-accuracy-high' | 'black-accuracy-high';

const SAVED_SORT_LABELS: Record<SavedSort, string> = {
  recent: 'Newest first',
  oldest: 'Oldest first',
  'accuracy-high': 'Highest accuracy',
  'accuracy-low': 'Lowest accuracy',
  'average-loss-low': 'Lowest avg loss',
  'red-accuracy-high': 'Red accuracy',
  'black-accuracy-high': 'Black accuracy',
};

interface LibraryPanelProps {
  savedGames: SavedGame[];
  libraryState: LibraryState;
  onLibraryChange: () => void;
  onLoadSavedGame: (game: SavedGame) => boolean;
  onDeleteSavedGame: (id: string) => boolean;
  onRenameSavedGame: (id: string, label: string) => boolean;
  onLoadHistorical: (game: HistoricalGame) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}


function savedResultToGameResult(result: SavedGame['result']) {
  if (result === 'red') return 'red-wins';
  if (result === 'black') return 'black-wins';
  if (result === 'draw') return 'draw';
  return null;
}

function makeSavedGamePgnFilename(game: SavedGame) {
  return pgnDownloadFilename(game.label || game.opening, new Date(game.savedAt), 'saved-game');
}

function countStudyLines(nodes: SavedGame['moveTree']): number {
  if (!nodes?.length) return 0;
  return nodes.reduce((sum, node) => {
    const childLines = countStudyLines(node.children);
    return sum + Math.max(1, childLines);
  }, 0);
}

function formatSavedGameMoveCount(game: SavedGame, line: LibraryPrimaryLine) {
  if (line.savedPath !== 'complete') {
    const location = line.savedPath === 'variation' ? 'saved on variation' : 'saved';
    return `${line.moves.length} main-line ${line.moves.length === 1 ? 'move' : 'moves'} · ${location} at ply ${game.moves.length}`;
  }
  if (game.moves.length > 0) {
    return `${game.moves.length} ${game.moves.length === 1 ? 'move' : 'moves'}`;
  }
  return game.moveTree?.length ? 'Start position' : '0 moves';
}

function savedReviewScope(game: SavedGame, line: LibraryPrimaryLine): string | undefined {
  if (!game.review || line.savedPath === 'complete') return undefined;
  if (line.savedPath === 'variation') return 'Review: saved variation';
  if (!game.moves.length) return 'Review: start position';
  return game.moves.length === 1 ? 'Review: first move' : `Review: first ${game.moves.length} moves`;
}

function formatSavedStudyLines(game: SavedGame) {
  const lineCount = countStudyLines(game.moveTree);
  if (lineCount === 0) return null;
  return `${lineCount} study ${lineCount === 1 ? 'line' : 'lines'}`;
}

function formatLibraryReviewSummary(summary: ReviewSummary) {
  return [
    `${summary.accuracy}% accuracy`,
    typeof summary.averageCentipawnLoss === 'number' ? `Avg loss ${formatAverageCentipawnLoss(summary.averageCentipawnLoss)}` : '',
    typeof summary.redAccuracy === 'number' ? `Red ${summary.redAccuracy}%` : '',
    typeof summary.blackAccuracy === 'number' ? `Black ${summary.blackAccuracy}%` : '',
    formatReviewCount(summary.blunderCount, 'blunder'),
    formatReviewCount(summary.mistakeCount, 'mistake'),
    formatReviewCount(summary.inaccuracyCount, 'inaccuracy', 'inaccuracies'),
    `Engine: ${describeReviewEngineSummary(summary.engine)}`,
    `reviewed ${formatDate(summary.reviewedAt)}`,
  ].filter(Boolean).join(', ');
}

function getSavedGameSearchText(game: SavedGame, line: LibraryPrimaryLine) {
  const summary = game.review?.summary;
  const annotations = game.review?.annotations ?? [];

  const parts = [
    game.label,
    game.rootComment,
    ...Object.values(game.metadata ?? {}),
    game.opening,
    game.gameMode,
    resultLabel(line.result ?? 'ongoing'),
    formatDate(game.savedAt),
    formatSavedGameMoveCount(game, line),
    formatSavedStudyLines(game),
    savedReviewScope(game, line),
    game.startFen,
    game.moves.join(' '),
    savedTreeSearchText(game.moveTree),
    typeof game.finalEval === 'number'
      ? `${evaluationSearchText(game.finalEval, game.finalEvalKind)} final saved position`
      : '',
    summary ? formatLibraryReviewSummary(summary) : '',
    summary?.lineSignature,
    summary ? formatReviewEngineSummary(summary.engine) : '',
    ...(summary?.keyMoments ?? []).flatMap((moment) => [
      moment.side,
      moment.quality,
      moment.playedMove,
      moment.bestMove,
      moment.note,
      `${moment.swing}cp swing`,
    ]),
    ...annotations.flatMap((annotation) => [
      annotation.bestMove,
      annotation.quality,
      annotation.reviewNote,
      evaluationSearchText(annotation.evalScore, annotation.evalScoreKind),
      typeof annotation.swing === 'number' ? `${annotation.swing}cp swing` : '',
    ]),
  ];

  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .toLowerCase();
}

function compareDefinedNumbers(
  left: number | undefined,
  right: number | undefined,
  direction: 'asc' | 'desc'
) {
  const leftMissing = typeof left !== 'number';
  const rightMissing = typeof right !== 'number';
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return direction === 'asc' ? left - right : right - left;
}

function compareSavedGames(left: SavedGame, right: SavedGame, sort: SavedSort) {
  const recentTieBreak = right.savedAt - left.savedAt;
  switch (sort) {
    case 'oldest':
      return left.savedAt - right.savedAt;
    case 'accuracy-high':
      return compareDefinedNumbers(left.review?.summary.accuracy, right.review?.summary.accuracy, 'desc') || recentTieBreak;
    case 'accuracy-low':
      return compareDefinedNumbers(left.review?.summary.accuracy, right.review?.summary.accuracy, 'asc') || recentTieBreak;
    case 'average-loss-low':
      return compareDefinedNumbers(left.review?.summary.averageCentipawnLoss, right.review?.summary.averageCentipawnLoss, 'asc') || recentTieBreak;
    case 'red-accuracy-high':
      return compareDefinedNumbers(left.review?.summary.redAccuracy, right.review?.summary.redAccuracy, 'desc') || recentTieBreak;
    case 'black-accuracy-high':
      return compareDefinedNumbers(left.review?.summary.blackAccuracy, right.review?.summary.blackAccuracy, 'desc') || recentTieBreak;
    case 'recent':
    default:
      return recentTieBreak;
  }
}

function buildSavedGamePgn(game: SavedGame) {
  if (game.moveTree?.length) {
    const pgn = exportPgnFromMoveTree(game.moveTree, {
      mainLineMoves: game.moves,
      gameMode: game.gameMode,
      opening: game.opening,
      result: savedResultToGameResult(game.result),
      label: game.label,
      metadata: game.metadata,
      startFen: game.startFen,
      rootComment: game.rootComment,
      rootResult: game.rootResult,
      mainLinePinned: game.mainLinePinned,
    });
    if (pgn) return pgn;
  }

  return exportPgnFromUci(game.moves, {
    gameMode: game.gameMode,
    opening: game.opening,
    result: savedResultToGameResult(game.result),
    label: game.label,
    metadata: game.metadata,
    startFen: game.startFen,
    rootComment: game.rootComment,
    rootResult: game.rootResult,
    mainLinePinned: game.mainLinePinned,
  });
}

export function LibraryPanel({
  savedGames,
  libraryState,
  onLibraryChange,
  onLoadSavedGame,
  onDeleteSavedGame,
  onRenameSavedGame,
  onLoadHistorical,
}: LibraryPanelProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const [failedActionId, setFailedActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedVisibleLimit, setSavedVisibleLimit] = useState(SAVED_PAGE_SIZE);
  /**
   * The saved-game list is one tab stop. A page of it holds a hundred games
   * with five buttons each, and every one was in the tab order, so reaching
   * the historical games below meant Tab five hundred times. The stop is
   * one card (wherever focus was last, else the first); Up and Down move to
   * the same button of the card above or below, Home and End to the ends.
   */
  const [rovingSavedIndex, setRovingSavedIndex] = useState<number | null>(null);
  const savedListRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const pendingFocusRef = useRef<{ id: string; index: number; selector: string } | null>(null);
  const copiedToastTimerRef = useRef<number | null>(null);
  const downloadedToastTimerRef = useRef<number | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'reviewed' | 'unreviewed'>('all');
  const [resultFilter, setResultFilter] = useState<'all' | 'red' | 'black' | 'draw' | 'ongoing'>('all');
  const [savedSort, setSavedSort] = useState<SavedSort>('recent');

  useEffect(() => {
    return () => {
      if (copiedToastTimerRef.current !== null) {
        window.clearTimeout(copiedToastTimerRef.current);
      }
      if (downloadedToastTimerRef.current !== null) {
        window.clearTimeout(downloadedToastTimerRef.current);
      }
    };
  }, []);

  const searchTerms = useMemo(() => toSearchTerms(search), [search]);
  const q = searchTerms.join(' ');

  useEffect(() => {
    setSavedVisibleLimit(SAVED_PAGE_SIZE);
  }, [q, reviewFilter, resultFilter, savedSort]);

  const filteredHistorical = useMemo(() => HISTORICAL_GAMES.filter((g) => {
    if (reviewFilter === 'reviewed') return false;
    if (resultFilter !== 'all' && g.result !== resultFilter) return false;
    return matchesSearchTerms(
      toSearchText([g.redPlayer, g.blackPlayer, g.event, g.date, g.opening]),
      searchTerms,
    );
  }), [searchTerms, resultFilter, reviewFilter]);

  // Format dates, review summaries and variation text once per game, so that
  // typing re-filters without re-deriving. Populated lazily: an empty search
  // needs none of this work. Keyed on the game object rather than its id, which
  // is what makes one map enough for the life of the panel -- every library
  // mutation re-reads storage and hands back fresh objects, so a game that
  // changed cannot be read back through a stale entry.
  const savedSearchText = useMemo(() => new WeakMap<SavedGame, string>(), []);
  // A primary line can span 1,024 nodes. Resolve it once per immutable saved
  // record, rather than walking every tree again on each filter keystroke.
  const savedPrimaryLines = useMemo(() => new WeakMap<SavedGame, LibraryPrimaryLine>(), []);
  const getSavedPrimaryLine = useCallback((game: SavedGame) => {
    let line = savedPrimaryLines.get(game);
    if (!line) {
      const primary = savedGameLine(game);
      const prefixMatches = game.moves.every((move, i) => move === primary.moves[i]);
      const savedPath = !prefixMatches ? 'variation' : game.moves.length === primary.moves.length ? 'complete' : 'prefix';
      line = { ...primary, savedPath };
      savedPrimaryLines.set(game, line);
    }
    return line;
  }, [savedPrimaryLines]);
  const filteredSaved = useMemo(() => savedGames
    .filter((g) => {
      const isReviewed = Boolean(g.review);
      if (reviewFilter === 'reviewed' && !isReviewed) return false;
      if (reviewFilter === 'unreviewed' && isReviewed) return false;
      if (resultFilter !== 'all' && (getSavedPrimaryLine(g).result ?? 'ongoing') !== resultFilter) return false;
      if (searchTerms.length === 0) return true;
      let text = savedSearchText.get(g);
      if (text === undefined) {
        text = getSavedGameSearchText(g, getSavedPrimaryLine(g));
        savedSearchText.set(g, text);
      }
      return matchesSearchTerms(text, searchTerms);
    })
    .sort((left, right) => compareSavedGames(left, right, savedSort)), [searchTerms, resultFilter, reviewFilter, savedGames, savedSort, savedSearchText, getSavedPrimaryLine]);
  const reviewInsight = useMemo(() => {
    const reviewed = filteredSaved
      .map((game) => game.review?.summary)
      .filter((summary): summary is ReviewSummary => Boolean(summary));
    if (reviewed.length === 0) return null;

    const accuracy = Math.round(
      reviewed.reduce((sum, summary) => sum + summary.accuracy, 0) / reviewed.length
    );
    const lossSummaries = reviewed.filter((summary) => typeof summary.averageCentipawnLoss === 'number');
    const averageCentipawnLoss = lossSummaries.length > 0
      ? Math.round(
        lossSummaries.reduce((sum, summary) => sum + (summary.averageCentipawnLoss ?? 0), 0) / lossSummaries.length
      )
      : undefined;

    return {
      reviewedCount: reviewed.length,
      accuracy,
      averageCentipawnLoss,
    };
  }, [filteredSaved]);
  const visibleSaved = filteredSaved.slice(0, savedVisibleLimit);
  // Explicit edits replace/remove the focused DOM node. Restore focus after
  // the commit, preferring the same game, then its neighbor, then search.
  // Storage events alone never request focus or interrupt another input.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const cards = Array.from(savedListRef.current?.querySelectorAll<HTMLElement>('.lib-card[data-game-id]') ?? []);
    const sameCard = cards.find(card => card.dataset.gameId === pending.id);
    const neighbor = cards[Math.max(0, Math.min(pending.index, cards.length - 1))];
    const target = sameCard?.querySelector<HTMLElement>(pending.selector)
      ?? neighbor?.querySelector<HTMLElement>('[data-testid^="load-saved-"]')
      ?? searchRef.current;
    target?.focus();
  });
  const restoreActionFocus = (id: string, selector: string) => {
    pendingFocusRef.current = { id, index: visibleSaved.findIndex(game => game.id === id), selector };
  };
  const savedStopIndex = rovingTabStopIndex(visibleSaved.length, rovingSavedIndex, 0);
  const handleSavedListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target instanceof HTMLInputElement) return;
    const card = target.closest<HTMLElement>('.lib-card[data-card-index]');
    if (!card) return;
    const from = Number(card.dataset.cardIndex);
    const key = event.key === 'ArrowUp' ? 'ArrowLeft' : event.key === 'ArrowDown' ? 'ArrowRight' : event.key;
    const next = rovingIndexForKey(key, visibleSaved.length, from);
    if (next === null || next === from) { event.preventDefault(); return; }
    event.preventDefault();
    const cards = savedListRef.current?.querySelectorAll<HTMLElement>('.lib-card[data-card-index]');
    const nextCard = cards?.[next];
    if (!nextCard) return;
    // The same button of the next card when it has one, else its Load.
    const position = [...card.querySelectorAll<HTMLElement>('button')].indexOf(target);
    const buttons = [...nextCard.querySelectorAll<HTMLElement>('button')];
    const load = nextCard.querySelector<HTMLElement>('[data-testid^="load-saved-"]');
    (buttons[position] ?? load ?? buttons[0])?.focus();
    setRovingSavedIndex(next);
  }, [visibleSaved.length]);
  const savedGameSummaryLabel = filteredSaved.length === 1 ? 'saved game' : 'saved games';
  const classicGameSummaryLabel = filteredHistorical.length === 1 ? 'classic game' : 'classic games';
  const reviewedGameSummaryLabel = reviewInsight?.reviewedCount === 1 ? 'reviewed game' : 'reviewed games';
  const savedSortLabel = SAVED_SORT_LABELS[savedSort];
  const reviewInsightLabel = reviewInsight
    ? [
      `${reviewInsight.reviewedCount} ${reviewedGameSummaryLabel}`,
      `average accuracy ${reviewInsight.accuracy}%`,
      typeof reviewInsight.averageCentipawnLoss === 'number'
        ? `average centipawn loss ${formatAverageCentipawnLoss(reviewInsight.averageCentipawnLoss)}`
        : '',
    ].filter(Boolean).join(', ')
    : '';

  const startEdit = (game: SavedGame) => {
    setPendingDeleteId(null);
    setActionError(null);
    setFailedActionId(null);
    setEditingId(game.id);
    setEditLabel(game.label ?? '');
  };

  const commitEdit = (id: string) => {
    const ok = onRenameSavedGame(id, editLabel.trim());
    if (!ok) {
      setActionError('Could not rename this game. Browser storage may be full or blocked.');
      return;
    }
    setActionError(null);
    setFailedActionId(null);
    restoreActionFocus(id, '.lib-game-name-button');
    setEditingId(null);
  };

  const cancelEdit = (id: string) => {
    setActionError(null);
    setFailedActionId(null);
    restoreActionFocus(id, '.lib-game-name-button');
    setEditingId(null);
  };

  const confirmDelete = (id: string) => {
    const ok = onDeleteSavedGame(id);
    if (!ok) {
      setActionError('Could not delete this game. Browser storage may be full or blocked.');
      return;
    }
    setActionError(null);
    setFailedActionId(null);
    restoreActionFocus(id, '[data-testid^="load-saved-"]');
    setPendingDeleteId(null);
  };

  const copySavedGamePgn = async (game: SavedGame) => {
    const pgn = buildSavedGamePgn(game);
    const ok = await copyToClipboard(pgn);
    if (!ok) {
      setFailedActionId(`copy-${game.id}`);
      setActionError('Could not copy this PGN. Check clipboard permissions and try again.');
      return;
    }

    setActionError(null);
    setFailedActionId(null);
    if (copiedToastTimerRef.current !== null) {
      window.clearTimeout(copiedToastTimerRef.current);
    }
    setCopiedId(game.id);
    copiedToastTimerRef.current = window.setTimeout(() => {
      copiedToastTimerRef.current = null;
      setCopiedId(null);
    }, 1800);
  };

  const downloadSavedGamePgn = (game: SavedGame) => {
    const ok = downloadTextFile(
      makeSavedGamePgnFilename(game),
      buildSavedGamePgn(game),
      'application/x-chess-pgn;charset=utf-8'
    );
    if (!ok) {
      setFailedActionId(`download-${game.id}`);
      setActionError('Could not download this PGN. Browser downloads may be blocked.');
      return;
    }

    setActionError(null);
    setFailedActionId(null);
    if (downloadedToastTimerRef.current !== null) {
      window.clearTimeout(downloadedToastTimerRef.current);
    }
    setDownloadedId(game.id);
    downloadedToastTimerRef.current = window.setTimeout(() => {
      downloadedToastTimerRef.current = null;
      setDownloadedId(null);
    }, 1800);
  };

  const loadSavedGame = (game: SavedGame) => {
    const ok = onLoadSavedGame(game);
    if (!ok) {
      setFailedActionId(`load-${game.id}`);
      setActionError('Could not load this game. Its saved move data is invalid.');
      return;
    }

    setActionError(null);
    setFailedActionId(null);
  };

  return (
    <div className="lib-panel">
      <LibraryTransfer state={libraryState} onChange={onLibraryChange} />
      <LibraryPgnImport state={libraryState} onChange={onLibraryChange} />
      <div className="lib-search-wrap">
        <input
          className="lib-search"
          ref={searchRef}
          type="search"
          placeholder="Search players, openings, moves, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search library"
          // Matching truncates past this anyway; stopping it at the input
          // keeps a pasted record out of React state as well.
          maxLength={MAX_SEARCH_QUERY_LENGTH}
        />
      </div>
      <div className="lib-filter-row">
        <select
          className="lib-filter-select"
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value as typeof reviewFilter)}
          aria-label="Filter by review status"
        >
          <option value="all">All reviews</option>
          <option value="reviewed">Reviewed</option>
          <option value="unreviewed">Unreviewed</option>
        </select>
        <select
          className="lib-filter-select"
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as typeof resultFilter)}
          aria-label="Filter by result"
        >
          <option value="all">All results</option>
          <option value="red">Red wins</option>
          <option value="black">Black wins</option>
          <option value="draw">Draw</option>
          <option value="ongoing">Ongoing</option>
        </select>
        <select
          className="lib-filter-select"
          value={savedSort}
          onChange={(e) => setSavedSort(e.target.value as SavedSort)}
          aria-label="Sort saved games"
        >
          <option value="recent">{SAVED_SORT_LABELS.recent}</option>
          <option value="oldest">{SAVED_SORT_LABELS.oldest}</option>
          <option value="accuracy-high">{SAVED_SORT_LABELS['accuracy-high']}</option>
          <option value="accuracy-low">{SAVED_SORT_LABELS['accuracy-low']}</option>
          <option value="average-loss-low">{SAVED_SORT_LABELS['average-loss-low']}</option>
          <option value="red-accuracy-high">{SAVED_SORT_LABELS['red-accuracy-high']}</option>
          <option value="black-accuracy-high">{SAVED_SORT_LABELS['black-accuracy-high']}</option>
        </select>
      </div>
      <div
        className="lib-summary-row"
        aria-label={[
          `${filteredSaved.length} ${savedGameSummaryLabel}.`,
          `${filteredHistorical.length} ${classicGameSummaryLabel}.`,
          reviewInsightLabel ? `${reviewInsightLabel}.` : '',
          `Sorted by ${savedSortLabel}.`,
        ].filter(Boolean).join(' ')}
      >
        <span className="lib-summary-pill">
          <strong>{filteredSaved.length}</strong> saved
        </span>
        <span className="lib-summary-pill" data-testid="library-classics-count">
          <strong>{filteredHistorical.length}</strong> classics
        </span>
        {reviewInsight ? (
          <>
            <span
              className="lib-summary-pill"
              aria-label={`${reviewInsight.reviewedCount} ${reviewedGameSummaryLabel}`}
            >
              <strong>{reviewInsight.reviewedCount}</strong> reviewed
            </span>
            <span
              className="lib-summary-pill"
              aria-label={`Average reviewed-game accuracy ${reviewInsight.accuracy}%`}
            >
              <strong>{reviewInsight.accuracy}%</strong> avg
            </span>
            {typeof reviewInsight.averageCentipawnLoss === 'number' ? (
              <span
                className="lib-summary-pill"
                aria-label={`Average reviewed-game centipawn loss ${formatAverageCentipawnLoss(reviewInsight.averageCentipawnLoss)}`}
              >
                <strong>{formatAverageCentipawnLoss(reviewInsight.averageCentipawnLoss)}</strong> loss
              </span>
            ) : null}
          </>
        ) : null}
        {(q || reviewFilter !== 'all' || resultFilter !== 'all' || savedSort !== 'recent') ? (
          <button
            type="button"
            className="lib-clear-filters"
            /* No aria-label: it would replace the accessible name, and WCAG 2.5.3
               wants a control's name to contain its visible text. The title
               becomes the description instead. */
            title="Clear the search and filters"
            onClick={() => {
              setSearch('');
              setReviewFilter('all');
              setResultFilter('all');
              setSavedSort('recent');
            }}
          >
            Reset
          </button>
        ) : null}
      </div>
      {actionError ? (
        <div className="lib-action-error" role="alert" data-testid="library-action-error">
          {actionError}
        </div>
      ) : null}

      {/* ── My Games ── */}
      <div className="lib-section-header">My Games</div>
      <div className="lib-list" data-testid="saved-game-list" ref={savedListRef} onKeyDown={handleSavedListKeyDown}>
        {filteredSaved.length === 0 ? (
          <p className="lib-empty">
            {savedGames.length === 0
              ? 'No saved games yet. Use the Save button to save the current game.'
              : 'No games match your search.'}
          </p>
        ) : (
          visibleSaved.map((game, cardIndex) => {
            const savedTabIndex = cardIndex === savedStopIndex ? 0 : -1;
            const studyLineLabel = formatSavedStudyLines(game);
            const primaryLine = getSavedPrimaryLine(game);
            const primaryResult = primaryLine.result ?? 'ongoing';
            const savedGameLabel = game.label || `Game — ${formatDate(game.savedAt)}`;
            const reviewScope = savedReviewScope(game, primaryLine);
            const reviewSummaryLabel = game.review
              ? [reviewScope, formatLibraryReviewSummary(game.review.summary)].filter(Boolean).join(', ') : '';
            const blunderLabel = game.review ? formatReviewCount(game.review.summary.blunderCount, 'blunder') : '';
            const mistakeLabel = game.review ? formatReviewCount(game.review.summary.mistakeCount, 'mistake') : '';
            const inaccuracyLabel = game.review ? formatReviewCount(game.review.summary.inaccuracyCount, 'inaccuracy', 'inaccuracies') : '';
            const averageLossLabel = typeof game.review?.summary.averageCentipawnLoss === 'number'
              ? `Average centipawn loss ${formatAverageCentipawnLoss(game.review.summary.averageCentipawnLoss)}`
              : '';
            const reviewEngineLabel = game.review ? formatReviewEngineSummary(game.review.summary.engine) : '';
            const reviewEngineDetail = game.review ? describeReviewEngineSummary(game.review.summary.engine) : '';
            const reviewSideAccuracy = game.review ? [
              { key: 'red', label: 'Red', value: game.review.summary.redAccuracy },
              { key: 'black', label: 'Black', value: game.review.summary.blackAccuracy },
            ].filter((item): item is { key: 'red' | 'black'; label: string; value: number } => typeof item.value === 'number') : [];
            return (
              <div
                key={game.id}
                className="lib-card"
                data-card-index={cardIndex}
                data-game-id={game.id}
                onFocusCapture={() => setRovingSavedIndex(cardIndex)}
              >
              <div className="lib-card-title">
                {editingId === game.id ? (
                  <form
                    className="lib-rename-form"
                    onSubmit={(e) => { e.preventDefault(); commitEdit(game.id); }}
                    onKeyDown={event => {
                      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelEdit(game.id); }
                    }}
                    data-testid={`rename-form-saved-${game.id}`}
                    aria-label={`Rename ${savedGameLabel}`}
                  >
                    <input
                      autoFocus
                      className="lib-rename-input"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Game name…"
                      aria-label={`Rename ${savedGameLabel}`}
                    />
                    <button
                      tabIndex={savedTabIndex}
                      type="submit"
                      className="chip-btn"
                      aria-label={`Save rename for ${savedGameLabel}`}
                      title={`Save rename for ${savedGameLabel}`}
                      data-testid={`save-rename-saved-${game.id}`}
                    >
                      Save
                    </button>
                    <button
                      tabIndex={savedTabIndex}
                      type="button"
                      className="chip-btn"
                      onClick={() => cancelEdit(game.id)}
                      aria-label={`Cancel rename for ${savedGameLabel}`}
                      title={`Cancel rename for ${savedGameLabel}`}
                      data-testid={`cancel-rename-saved-${game.id}`}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    tabIndex={savedTabIndex}
                    type="button"
                    className="lib-game-name-button"
                    onClick={() => startEdit(game)}
                    title={`Rename ${savedGameLabel}`}
                  >
                    {savedGameLabel}
                  </button>
                )}
                <div className="lib-card-actions lib-card-actions--inline">
                  <button
                    tabIndex={savedTabIndex}
                    type="button"
                    className={`chip-btn ${copiedId === game.id ? 'chip-btn-primary' : ''} ${failedActionId === `copy-${game.id}` ? 'chip-btn-warning' : ''}`}
                    onClick={() => copySavedGamePgn(game)}
                    title={`Copy PGN for ${savedGameLabel}`}
                    aria-label={copiedId === game.id ? `Copied PGN for ${savedGameLabel}` : `Copy PGN for ${savedGameLabel}`}
                    data-testid={`copy-pgn-saved-${game.id}`}
                  >
                    {copiedId === game.id ? <><IconCheck /> Copied</> : <><IconCopy /> PGN</>}
                  </button>
                  <button
                    tabIndex={savedTabIndex}
                    type="button"
                    className={`chip-btn ${downloadedId === game.id ? 'chip-btn-primary' : ''} ${failedActionId === `download-${game.id}` ? 'chip-btn-warning' : ''}`}
                    onClick={() => downloadSavedGamePgn(game)}
                    title={`Download PGN for ${savedGameLabel}`}
                    aria-label={downloadedId === game.id ? `Downloaded PGN for ${savedGameLabel}` : `Download PGN for ${savedGameLabel}`}
                    data-testid={`download-pgn-saved-${game.id}`}
                  >
                    {downloadedId === game.id ? <><IconCheck /> Saved</> : <><IconDownload /> File</>}
                  </button>
                  <button
                    tabIndex={savedTabIndex}
                    type="button"
                    className={`chip-btn chip-btn-primary ${failedActionId === `load-${game.id}` ? 'chip-btn-warning' : ''}`}
                    onClick={() => loadSavedGame(game)}
                    aria-label={`Load ${savedGameLabel}`}
                    data-testid={`load-saved-${game.id}`}
                  >
                    <IconRefresh /> Load
                  </button>
                  {pendingDeleteId === game.id ? (
                    <>
                      <button
                        tabIndex={savedTabIndex}
                        type="button"
                        className="chip-btn chip-btn-danger chip-btn-danger-armed"
                        onClick={() => confirmDelete(game.id)}
                        data-testid={`confirm-delete-saved-${game.id}`}
                        aria-label={`Confirm delete ${savedGameLabel}`}
                        title={`Confirm delete ${savedGameLabel}`}
                      >
                        Delete
                      </button>
                      <button
                        tabIndex={savedTabIndex}
                        type="button"
                        className="chip-btn"
                        onClick={() => {
                          setActionError(null); setFailedActionId(null);
                          restoreActionFocus(game.id, '[data-testid^="delete-saved-"]');
                          setPendingDeleteId(null);
                        }}
                        aria-label={`Cancel delete ${savedGameLabel}`}
                        title={`Cancel delete ${savedGameLabel}`}
                        data-testid={`cancel-delete-saved-${game.id}`}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      tabIndex={savedTabIndex}
                      type="button"
                      className="chip-btn chip-btn-danger"
                      onClick={() => {
                        setEditingId(null);
                        setActionError(null);
                        setFailedActionId(null);
                        restoreActionFocus(game.id, '[data-testid^="confirm-delete-saved-"]');
                        setPendingDeleteId(game.id);
                      }}
                      title={`Delete ${savedGameLabel}`}
                      aria-label={`Delete ${savedGameLabel}`}
                      data-testid={`delete-saved-${game.id}`}
                    >
                      <IconX />
                    </button>
                  )}
                </div>
              </div>
              {game.metadata && (() => {
                // Both lines are clamped to two rows in CSS, because these are
                // player-supplied and bounded only at 256 characters apiece --
                // one imported game with a long enough event name filled the
                // whole panel and pushed every other saved game off it. The
                // title carries whatever the clamp cuts.
                const players = `Red: ${game.metadata.redPlayer || 'Unknown'} · Black: ${game.metadata.blackPlayer || 'Unknown'}`;
                const tournament = [game.metadata.event, game.metadata.site, game.metadata.date,
                  game.metadata.round ? `Round ${game.metadata.round}` : undefined].filter(Boolean).join(' · ');
                return (
                  <div className="lib-tournament-details" data-testid={`metadata-saved-${game.id}`}>
                    {(game.metadata.redPlayer || game.metadata.blackPlayer) && (
                      <div className="lib-detail-line" title={players}>{players}</div>
                    )}
                    <div className="lib-detail-line" title={tournament || undefined}>{tournament}</div>
                  </div>
                );
              })()}
              <div className="lib-card-meta">
                <span>{game.gameMode}</span>
                <span className={`lib-result lib-result--${primaryResult}`} title="Primary line result">
                  {resultLabel(primaryResult)}
                </span>
                <span>{formatSavedGameMoveCount(game, primaryLine)}</span>
                {studyLineLabel ? (
                  <>
                    <span>{studyLineLabel}</span>
                  </>
                ) : null}
                {game.opening && (
                  <>
                    <span className="lib-opening">{game.opening}</span>
                  </>
                )}
                {typeof game.finalEval === 'number' && (
                  <>
                    <span className={`lib-eval ${game.finalEval > 0 ? 'lib-eval--pos' : 'lib-eval--neg'}`}>
                      {primaryLine.savedPath !== 'complete' ? 'Saved position: ' : ''}
                      {formatEvaluationText(game.finalEval, 2, game.finalEvalKind) ?? 'n/a'}
                    </span>
                  </>
                )}
                {/* An unnamed game is titled by its date, so repeating it here
                    said the same thing twice on one card. A renamed game still
                    needs it: its title no longer carries the date. */}
                {game.label ? <span className="lib-date">{formatDate(game.savedAt)}</span> : null}
              </div>
              {game.review ? (
                <div
                  className="lib-review-meta"
                  aria-label={`Review summary for ${savedGameLabel}: ${reviewSummaryLabel}`}
                  title={reviewSummaryLabel}
                  data-testid={`review-meta-saved-${game.id}`}
                >
                  {reviewScope && <span className="lib-review-scope" data-testid={`review-scope-saved-${game.id}`}>{reviewScope}</span>}
                  <span className="lib-review-pill" aria-label={`${game.review.summary.accuracy}% review accuracy`}>
                    {game.review.summary.accuracy}% accuracy
                  </span>
                  {typeof game.review.summary.averageCentipawnLoss === 'number' ? (
                    <span
                      className="lib-review-pill lib-review-pill-average-loss"
                      aria-label={averageLossLabel}
                      title={averageLossLabel}
                      data-testid={`review-average-loss-saved-${game.id}`}
                    >
                      Avg loss {formatAverageCentipawnLoss(game.review.summary.averageCentipawnLoss)}
                    </span>
                  ) : null}
                  {reviewSideAccuracy.map((item) => (
                    <span
                      key={item.key}
                      className={`lib-review-pill lib-review-pill-${item.key}-accuracy`}
                      aria-label={`${item.label} review accuracy ${item.value}%`}
                      title={`${item.label} review accuracy ${item.value}%`}
                      data-testid={`review-${item.key}-accuracy-saved-${game.id}`}
                    >
                      {item.label} {item.value}%
                    </span>
                  ))}
                  <span
                    className="lib-review-pill lib-review-pill-blunder"
                    aria-label={blunderLabel}
                    title={blunderLabel}
                    data-testid={`review-blunders-saved-${game.id}`}
                  >
                    {blunderLabel}
                  </span>
                  <span
                    className="lib-review-pill lib-review-pill-mistake"
                    aria-label={mistakeLabel}
                    title={mistakeLabel}
                    data-testid={`review-mistakes-saved-${game.id}`}
                  >
                    {mistakeLabel}
                  </span>
                  <span
                    className="lib-review-pill lib-review-pill-inaccuracy"
                    aria-label={inaccuracyLabel}
                    title={inaccuracyLabel}
                    data-testid={`review-inaccuracies-saved-${game.id}`}
                  >
                    {inaccuracyLabel}
                  </span>
                  <span
                    className="lib-review-pill lib-review-pill-engine"
                    aria-label={`Review engine: ${reviewEngineDetail}`}
                    title={`Review engine: ${reviewEngineDetail}`}
                    data-testid={`review-engine-saved-${game.id}`}
                  >
                    Engine {reviewEngineLabel}
                  </span>
                  <span className="lib-review-date">
                    Reviewed {formatDate(game.review.summary.reviewedAt)}
                  </span>
                </div>
              ) : null}
              </div>
            );
          })
        )}
      </div>
      {filteredSaved.length > visibleSaved.length ? (
        <button
          type="button"
          className="lib-load-more"
          onClick={() => setSavedVisibleLimit((limit) => limit + SAVED_PAGE_SIZE)}
          data-testid="library-show-more-saved"
        >
          Show {Math.min(SAVED_PAGE_SIZE, filteredSaved.length - visibleSaved.length)} more saved games
        </button>
      ) : null}

      {/* ── Classic Openings ──
          Called openings, not games, because that is what they are: each entry
          is the first eight to twelve moves a side of a real game, not the
          whole thing. Labelling them "Classic Games" next to a decisive result
          badge claimed something twenty-odd plies cannot show, and Game Review
          then scored the excerpt as if it were a finished game -- which is how
          a Hu Ronghua opening came out at 25% accuracy with twelve blunders. */}
      <div className="lib-section-header">Classic Openings</div>
      <p className="lib-section-note">
        Opening excerpts from famous games. The result shown is how the full
        game finished, not the position these moves reach.
      </p>
      <div className="lib-list" data-testid="historical-game-list">
        {filteredHistorical.length === 0 ? (
          // Two different nothings. "No games match your search" in front of a
          // section that has no games at all sends someone hunting for a filter
          // to clear.
          <p className="lib-empty">
            {HISTORICAL_GAMES.length === 0
              ? 'No classic games are bundled yet.'
              : 'No games match your search.'}
          </p>
        ) : (
          filteredHistorical.map((game) => (
            <div key={game.id} className="lib-card lib-card-aside-action">
              <div className="lib-card-title">
                <span className="lib-matchup">
                  {game.redPlayer} <span className="lib-vs">vs</span> {game.blackPlayer}
                </span>
                <span
                  className={`lib-result lib-result--${game.result}`}
                  title={`${resultLabel(game.result)} — the full game's result. These moves are the opening only.`}
                >
                  {resultLabel(game.result)}
                </span>
              </div>
              <div className="lib-card-meta">
                <span>{game.event}</span>
                <span>{game.date}</span>
                <span>opening · {game.moves.length} plies</span>
                {game.opening && (
                  <>
                    <span className="lib-opening">{game.opening}</span>
                  </>
                )}
              </div>
              <div className="lib-card-actions">
                <button
                  type="button"
                  className="chip-btn chip-btn-primary"
                  onClick={() => onLoadHistorical(game)}
                  data-testid={`load-historical-${game.id}`}
                  aria-label={`Load the opening of ${game.redPlayer} versus ${game.blackPlayer}, ${game.moves.length} plies`}
                >
                  <IconRefresh /> Load
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
