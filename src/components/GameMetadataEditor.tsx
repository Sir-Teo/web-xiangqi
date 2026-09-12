import { GAME_METADATA_FIELDS, MAX_METADATA_FIELD_LENGTH, type GameMetadata } from '../utils/gameMetadata';
import './GameMetadataEditor.css';

const labels: Record<keyof GameMetadata, string> = {
  redPlayer: 'Red player', blackPlayer: 'Black player', event: 'Event',
  site: 'Site', date: 'Game date', round: 'Round',
  redRating: 'Red rating', blackRating: 'Black rating', timeControl: 'Recorded time control', annotator: 'Annotator',
};
const placeholders: Partial<Record<keyof GameMetadata, string>> = {
  date: 'YYYY.MM.DD or 2020.??.??',
  redRating: 'e.g. 2500 or ?', blackRating: 'e.g. 2500 or ?',
  timeControl: 'PGN seconds, e.g. 600+5', annotator: 'Person or team credited',
};

export function GameMetadataEditor({ metadata, onChange }: {
  metadata?: GameMetadata;
  onChange: (metadata: GameMetadata) => void;
}) {
  const players = [metadata?.redPlayer, metadata?.blackPlayer].filter(Boolean).join(' · ');
  return <details className="game-metadata" data-testid="game-metadata">
    <summary>Game details{players && <span title={players}>{players}</span>}</summary>
    <p>Players, ratings, tournament details and annotation credits stay with saved games and PGN exports.</p>
    <div className="game-metadata-fields">
      {GAME_METADATA_FIELDS.map(field => <label key={field}>
        {labels[field]}
        <input value={metadata?.[field] ?? ''} maxLength={MAX_METADATA_FIELD_LENGTH}
          onChange={event => onChange({ ...metadata, [field]: event.target.value })}
          placeholder={placeholders[field]}
          autoComplete="off" />
      </label>)}
    </div>
  </details>;
}
