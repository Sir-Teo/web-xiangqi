import { truncateText } from './truncateText';

/** Tournament facts, separate from the study's editable library label. */
export interface GameMetadata {
  redPlayer?: string;
  blackPlayer?: string;
  redRating?: string;
  blackRating?: string;
  event?: string;
  site?: string;
  date?: string;
  round?: string;
  timeControl?: string;
  annotator?: string;
}
export const GAME_METADATA_FIELDS = ['redPlayer', 'blackPlayer', 'redRating', 'blackRating', 'event', 'site', 'date', 'round', 'timeControl', 'annotator'] as const;
export const MAX_METADATA_FIELD_LENGTH = 256;

export function normalizeGameMetadata(value: unknown): GameMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const metadata: GameMetadata = {};
  for (const field of GAME_METADATA_FIELDS) {
    if (typeof record[field] !== 'string') continue;
    // Strip control characters from untrusted PGN and backup fields.
    // eslint-disable-next-line no-control-regex
    const text = truncateText(record[field].replace(/[\u0000-\u001f\u007f]/g, ' ').trim(), MAX_METADATA_FIELD_LENGTH);
    if (text) metadata[field] = text;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

/** Read the leading PGN headers only; comments and later games cannot supply tags. */
export function extractPgnHeaders(text: string): Record<string, string> {
  const tags: Record<string, string> = {};
  let source = text.replace(/^\uFEFF/, '').trimStart();
  const header = /^\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\s*\]/;
  for (;;) {
    const match = header.exec(source);
    if (!match) break;
    tags[match[1].toLowerCase()] = match[2].replace(/\\(["\\])/g, '$1');
    source = source.slice(match[0].length).trimStart();
  }
  return tags;
}

export function extractPgnMetadata(text: string): GameMetadata | undefined {
  const tags = extractPgnHeaders(text);
  return normalizeGameMetadata({
    redPlayer: tags.red ?? tags.white,
    blackPlayer: tags.black,
    redRating: tags.redelo ?? tags.whiteelo,
    blackRating: tags.blackelo,
    event: tags.event,
    site: tags.site,
    date: tags.date,
    round: tags.round,
    timeControl: tags.timecontrol,
    annotator: tags.annotator,
  });
}

export function formatRatedPlayer(name: string | undefined, rating: string | undefined, fallback: string): string {
  return `${name || fallback}${rating ? ` (${rating})` : ''}`;
}
