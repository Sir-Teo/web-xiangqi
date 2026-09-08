import { GAME_METADATA_FIELDS, MAX_METADATA_FIELD_LENGTH, type GameMetadata } from '../utils/gameMetadata';
import './GameMetadataEditor.css';

const labels: Record<keyof GameMetadata, string> = {
  redPlayer: 'Red player', blackPlayer: 'Black player', event: 'Event',
  site: 'Site', date: 'Game date', round: 'Round',
};

export function GameMetadataEditor({ metadata, onChange }: {
  metadata?: GameMetadata;
  onChange: (metadata: GameMetadata) => void;
}) {
  const players = [metadata?.redPlayer, metadata?.blackPlayer].filter(Boolean).join(' · ');
  return <details className="game-metadata" data-testid="game-metadata">
    <summary>Game details{players && <span title={players}>{players}</span>}</summary>
    <p>Players and tournament details stay with saved games and PGN exports.</p>
    <div className="game-metadata-fields">
      {GAME_METADATA_FIELDS.map(field => <label key={field}>
        {labels[field]}
        <input value={metadata?.[field] ?? ''} maxLength={MAX_METADATA_FIELD_LENGTH}
          onChange={event => onChange({ ...metadata, [field]: event.target.value })}
          placeholder={field === 'date' ? 'YYYY.MM.DD or 2020.??.??' : undefined}
          autoComplete="off" />
      </label>)}
    </div>
  </details>;
}
