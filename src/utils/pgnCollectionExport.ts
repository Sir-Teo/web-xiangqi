import { MAX_SAVED_GAMES } from './gameLibrary';
import { MAX_COLLECTION_TEXT_LENGTH } from './pgnCollection';
import { buildSavedGamePgn, type SavedGamePgnInput } from './savedGamePgn';

/** Build the complete collection or fail before publishing any partial file. */
export function exportPgnCollection(games: readonly SavedGamePgnInput[]): string {
  if (!games.length) throw new Error('No matching saved games to export.');
  if (games.length > MAX_SAVED_GAMES) throw new Error('Too many games. Narrow the library search or filters.');
  const records: string[] = [];
  let length = 0;
  for (const [index, game] of games.entries()) {
    const record = buildSavedGamePgn(game);
    if (record === null) throw new Error(`Game ${index + 1}${game.label ? ` (${game.label})` : ''} has saved moves that do not match its variations. No PGN was exported. Use Download library backup to keep the complete studies.`);
    length += record.length + (index ? 1 : 0);
    if (length > MAX_COLLECTION_TEXT_LENGTH) throw new Error('This collection is too large. Narrow the library search or filters and export smaller collections.');
    records.push(record);
  }
  return records.join('\n');
}
