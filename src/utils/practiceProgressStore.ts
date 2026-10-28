import { MAX_SAVED_MOVES, MAX_SAVED_TREE_NODES, type SavedGame } from './gameLibrary';
import { librarySource } from './librarySource';
import { normalizeMoveComment } from './moveComment';
import { parseFenBoard, START_POSITION_FEN, type Side } from './xiangqi';

export const PRACTICE_PROGRESS_KEY = 'xiangqi:practice-progress:v1';
export const MAX_PRACTICE_PROGRESS_LENGTH = 512_000;
export type PracticeProgressEntry = { id: string; revision: string; side: Side; updatedAt: number; sessions: Partial<Record<Side, unknown>> };
export type PracticeProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isEntry(value: unknown): value is PracticeProgressEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PracticeProgressEntry>;
  return Boolean(typeof entry.id === 'string' && typeof entry.revision === 'string'
    && (entry.side === 'w' || entry.side === 'b') && Number.isFinite(entry.updatedAt)
    && entry.sessions && typeof entry.sessions === 'object');
}

export function readPracticeEntries(storage: PracticeProgressStorage): PracticeProgressEntry[] {
  const raw = storage.getItem(PRACTICE_PROGRESS_KEY);
  if (!raw || raw.length > MAX_PRACTICE_PROGRESS_LENGTH) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 50) return [];
  return parsed.filter(isEntry);
}

const revisions = new WeakMap<SavedGame, string>();
/** Identity of the saved moves and notes taught in practice. */
export function practiceRevision(game: SavedGame): string {
  const cached = revisions.get(game);
  if (cached) return cached;
  const rows: unknown[] = [];
  if (game.moveTree?.length) {
    const stack = game.moveTree.slice().reverse().map(node => ({ node, depth: 0 }));
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (rows.length >= MAX_SAVED_TREE_NODES || depth >= MAX_SAVED_MOVES) throw new Error('Invalid practice study length');
      rows.push([depth, node.uci, normalizeMoveComment(node.comment)]);
      for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) stack.push({ node: node.children![i], depth: depth + 1 });
    }
  } else {
    if (game.moves.length > MAX_SAVED_MOVES) throw new Error('Invalid practice study length');
    game.moves.forEach((uci, depth) => rows.push([depth, uci, undefined]));
  }
  const fen = game.startFen || START_POSITION_FEN;
  const position = [parseFenBoard(fen), fen.trim().split(/\s+/)[1]];
  const text = JSON.stringify([position, normalizeMoveComment(game.rootComment), rows]);
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  const revision = `p2:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}:${text.length}`;
  revisions.set(game, revision);
  return revision;
}

export function matchesPracticeRevision(game: SavedGame, revision: string): boolean {
  return revision === practiceRevision(game)
    || (!revision.startsWith('p2:') && revision === librarySource(game).revision);
}

/** Preserve older progress before an update changes the legacy library fingerprint. */
export function migratePracticeProgressRevision(source: SavedGame, storage?: PracticeProgressStorage): boolean {
  try {
    const target = storage ?? localStorage;
    const raw = target.getItem(PRACTICE_PROGRESS_KEY);
    if (!raw) return true;
    if (raw.length > MAX_PRACTICE_PROGRESS_LENGTH) return false;
    const parsed: unknown = JSON.parse(raw);
    // A library update must not sanitize unreadable or future practice data.
    if (!Array.isArray(parsed) || parsed.length > 50 || !parsed.every(isEntry)) return false;
    if (!parsed.some(entry => entry.id === source.id && !entry.revision.startsWith('p2:'))) return true;
    const legacy = librarySource(source).revision;
    if (!parsed.some(entry => entry.id === source.id && entry.revision === legacy)) return true;
    const revision = practiceRevision(source);
    const updated = parsed.map(entry => entry.id === source.id && entry.revision === legacy ? { ...entry, revision } : entry);
    const serialized = JSON.stringify(updated);
    if (serialized.length > MAX_PRACTICE_PROGRESS_LENGTH) return false;
    target.setItem(PRACTICE_PROGRESS_KEY, serialized);
    return true;
  } catch { return false; }
}
