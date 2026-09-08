import { useState } from 'react';
import type { LibraryPositionHit } from '../../utils/positionExplorer';
import './LibraryMatches.css';

export function LibraryMatches({ hits, total, onOpen, onOpenLibrary }: {
  hits: LibraryPositionHit[];
  total: number;
  onOpen: (hit: LibraryPositionHit) => boolean;
  onOpenLibrary: () => void;
}) {
  const [failedHits, setFailedHits] = useState<LibraryPositionHit[] | null>(null);
  return (
    <details className="library-matches" data-testid="library-matches">
      <summary>Matching games ({total})</summary>
      <p>Open a game at its first visit to this position. Its full line and notes stay available.</p>
      <div className="library-matches-list">
        {hits.map(hit => (
          <button type="button" key={hit.gameId} onClick={() => setFailedHits(onOpen(hit) ? null : hits)} data-testid={`library-match-${hit.gameId}`}>
            <strong>{hit.label || hit.opening || 'Untitled game'}</strong>
            <span>{hit.ply === 0 ? 'Start position' : `After ${hit.ply} ${hit.ply === 1 ? 'ply' : 'plies'}`}{' · '}{
              hit.result === 'red-wins' ? 'Red won' : hit.result === 'black-wins' ? 'Black won' : hit.result === 'draw' ? 'Draw' : 'No result'
            }</span>
          </button>
        ))}
      </div>
      {total > hits.length && <p>Showing the {hits.length} most recently saved matching games.</p>}
      {failedHits === hits && <p role="alert">This saved game could not be opened. Its moves or variations may be invalid. Your current board is unchanged; open the library to download a backup.</p>}
      <button type="button" className="chip-btn" onClick={onOpenLibrary}>Open library</button>
    </details>
  );
}
