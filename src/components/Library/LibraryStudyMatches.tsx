import { useId, useMemo, useState } from 'react';
import type { SavedGame } from '../../utils/gameLibrary';
import { matchesSearchTerms } from '../../utils/searchTerms';
import { savedStudyMatchMoves, savedStudySearchEntries, type SavedStudySearchEntry } from '../../utils/savedStudySearch';
import { studyAnalysisScore } from '../../utils/studyAnalysis';

const PAGE_SIZE = 10;

function MatchPath({ entry, tabIndex }: { entry: SavedStudySearchEntry; tabIndex: number }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary tabIndex={tabIndex}>Move sequence</summary>
    {open && <code>{savedStudyMatchMoves(entry).join(' ')}</code>}
  </details>;
}

function Matches({ game, terms, tabIndex, onOpen }: {
  game: SavedGame; terms: string[]; tabIndex: number; onOpen: (moves: string[]) => void;
}) {
  const entries = useMemo(() => savedStudySearchEntries(game.moveTree), [game]);
  const matches = useMemo(() => entries.filter(entry => matchesSearchTerms(entry.text, terms)), [entries, terms]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  return <>
    <p>{matches.length ? `${matches.length} matching ${matches.length === 1 ? 'move' : 'moves'}. Open a position to read its notes and saved analysis.`
      : 'No single move matches every search word. This game matches through its details or several moves; try fewer words.'}</p>
    {matches.slice(0, limit).map((entry, index) => <div className="lib-study-match" key={index}>
      <button type="button" className="chip-btn" tabIndex={tabIndex} data-library-action="open-match"
        onClick={() => onOpen(savedStudyMatchMoves(entry))}>
        Open {entry.node.uci} · ply {entry.ply}
      </button>
      {entry.node.comment && <p className="lib-study-match-note">{entry.node.comment}</p>}
      {entry.node.analysis && <p>Saved analysis · {studyAnalysisScore(entry.node.analysis)} Red POV · D{entry.node.analysis.depth}
        {entry.node.analysis.bounded ? ` · ${entry.node.analysis.bound ?? ''} bound, not exact` : ''} · {entry.node.analysis.engine.name}</p>}
      <MatchPath entry={entry} tabIndex={tabIndex} />
    </div>)}
    {matches.length > limit && <button type="button" className="chip-btn" tabIndex={tabIndex}
      data-library-action="more-matches" onClick={() => setLimit(value => value + PAGE_SIZE)}>
      Show {Math.min(PAGE_SIZE, matches.length - limit)} more matching moves
    </button>}
  </>;
}

export function LibraryStudyMatches({ game, terms, formatKey, tabIndex, onOpen }: {
  game: SavedGame; terms: string[]; formatKey: string; tabIndex: number; onOpen: (moves: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className="lib-study-matches" data-testid={`study-matches-${game.id}`}>
    <button type="button" className="chip-btn lib-details-toggle" tabIndex={tabIndex} data-library-action="find-matches"
      aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Hide matching moves' : 'Find matching moves'}
    </button>
    <div id={id}>{expanded && <Matches key={formatKey} game={game} terms={terms} tabIndex={tabIndex} onOpen={onOpen} />}</div>
  </div>;
}
