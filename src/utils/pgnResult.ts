import { firstPgnGame } from './pgnText';
import { extractPgnHeaders } from './gameMetadata';
import { parseResultTag, type RecordedResult } from './recordedResult';

/** Read only the first game's top-level result, excluding notes and variations. */
export function extractPgnResult(text: string): { result?: RecordedResult; error?: string; source?: string; hadMoreGames?: boolean } {
    const header = extractPgnHeaders(text).result;
    if (header !== undefined && header !== '*' && !parseResultTag(header)) return { error: 'Invalid Result header.' };
    const { marker, text: source, truncated: hadMoreGames } = firstPgnGame(text);
    if (header !== undefined && marker !== undefined && header !== marker) return { error: 'The Result header disagrees with the final result marker.' };
    return { result: parseResultTag(marker ?? header), source, hadMoreGames };
}
