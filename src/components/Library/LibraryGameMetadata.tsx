import { useId, useState } from 'react';
import { formatRatedPlayer, type GameMetadata } from '../../utils/gameMetadata';
import { toSearchText } from '../../utils/searchTerms';
import { SearchText } from '../SearchText';

export function LibraryGameMetadata({ metadata, gameId, label, tabIndex, terms }: {
  metadata: GameMetadata; gameId: string; label: string; tabIndex: number; terms: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const players = `Red: ${formatRatedPlayer(metadata.redPlayer, metadata.redRating, 'Unknown')} · Black: ${formatRatedPlayer(metadata.blackPlayer, metadata.blackRating, 'Unknown')}`;
  const tournament = [metadata.event, metadata.site, metadata.date,
    metadata.round ? `Round ${metadata.round}` : undefined].filter(Boolean).join(' · ');
  const credits = [metadata.timeControl ? `Time control: ${metadata.timeControl}` : undefined,
    metadata.annotator ? `Annotated by ${metadata.annotator}` : undefined].filter(Boolean).join(' · ');
  const detail = (text: string) => {
    const searchable = toSearchText([text]);
    return <div className="lib-detail-line" title={text}
      data-search-match={terms.some(term => searchable.includes(term)) || undefined}>
      {/* Limit repeated marks so a page of long cards stays responsive. */}
      <SearchText text={text} terms={terms} maxMatchesPerTerm={8} />
    </div>;
  };
  return <div className="lib-tournament-details" data-testid={`metadata-saved-${gameId}`}>
    <button type="button" className="chip-btn lib-details-toggle" tabIndex={tabIndex}
      data-library-action="details"
      aria-expanded={expanded} aria-controls={contentId} aria-label={`Game details for ${label}`}
      onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> Game details
    </button>
    <div id={contentId} className="lib-details-content" data-expanded={expanded}>
      {(metadata.redPlayer || metadata.blackPlayer || metadata.redRating || metadata.blackRating) &&
        detail(players)}
      {tournament && detail(tournament)}
      {credits && detail(credits)}
    </div>
  </div>;
}
