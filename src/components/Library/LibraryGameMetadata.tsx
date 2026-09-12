import { useId, useState } from 'react';
import { formatRatedPlayer, type GameMetadata } from '../../utils/gameMetadata';

export function LibraryGameMetadata({ metadata, gameId, label, tabIndex }: {
  metadata: GameMetadata; gameId: string; label: string; tabIndex: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const players = `Red: ${formatRatedPlayer(metadata.redPlayer, metadata.redRating, 'Unknown')} · Black: ${formatRatedPlayer(metadata.blackPlayer, metadata.blackRating, 'Unknown')}`;
  const tournament = [metadata.event, metadata.site, metadata.date,
    metadata.round ? `Round ${metadata.round}` : undefined].filter(Boolean).join(' · ');
  const credits = [metadata.timeControl ? `Time control: ${metadata.timeControl}` : undefined,
    metadata.annotator ? `Annotated by ${metadata.annotator}` : undefined].filter(Boolean).join(' · ');
  return <div className="lib-tournament-details" data-testid={`metadata-saved-${gameId}`}>
    <button type="button" className="chip-btn lib-details-toggle" tabIndex={tabIndex}
      aria-expanded={expanded} aria-controls={contentId} aria-label={`Game details for ${label}`}
      onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> Game details
    </button>
    <div id={contentId} className="lib-details-content" data-expanded={expanded}>
      {(metadata.redPlayer || metadata.blackPlayer || metadata.redRating || metadata.blackRating) &&
        <div className="lib-detail-line" title={players}>{players}</div>}
      {tournament && <div className="lib-detail-line" title={tournament}>{tournament}</div>}
      {credits && <div className="lib-detail-line" title={credits}>{credits}</div>}
    </div>
  </div>;
}
