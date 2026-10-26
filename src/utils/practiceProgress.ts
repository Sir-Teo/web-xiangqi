import type { SavedGame } from './gameLibrary';
import { librarySource } from './librarySource';
import { playPracticeReply, practiceLineIndices, startPracticeLine, type PracticeSession, type PracticeStudy } from './studyPractice';
import type { Side } from './xiangqi';

export const PRACTICE_PROGRESS_KEY = 'xiangqi:practice-progress:v1';
const MAX_LENGTH = 512_000;
type Entry = { id: string; revision: string; side: Side; updatedAt: number; sessions: Partial<Record<Side, unknown>> };
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>;

function entries(storage: ProgressStorage): Entry[] {
  const raw = storage.getItem(PRACTICE_PROGRESS_KEY);
  if (!raw || raw.length > MAX_LENGTH) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 50) return [];
  return parsed.filter((entry): entry is Entry => Boolean(entry && typeof entry.id === 'string' && typeof entry.revision === 'string'
    && (entry.side === 'w' || entry.side === 'b') && Number.isFinite(entry.updatedAt) && entry.sessions && typeof entry.sessions === 'object'));
}

/** Rebuild from a validated prefix; never trust stored board state. */
export function restorePracticeSession(study: PracticeStudy, raw: unknown): PracticeSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<PracticeSession>;
  const integer = (n: unknown, max: number): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max;
  if (!integer(value.line, study.lines.length - 1) || !Array.isArray(value.moves) || value.moves.length > study.lineLengths[value.line]
    || !Array.isArray(value.completed) || value.completed.length > study.lines.length
    || !value.completed.every(index => integer(index, study.lines.length - 1))
    || !integer(value.answered, 1_000_000_000) || !integer(value.recalled, value.answered) || typeof value.assisted !== 'boolean') return null;
  let session = startPracticeLine(study, value.line);
  const line = study.lines[value.line];
  for (let i = 0; i < value.moves.length; i++) {
    if (value.moves[i] !== line[i]) return null;
    session = playPracticeReply(study, session, session.side === 'w' ? 'b' : 'w');
    if (session.moves.length !== i + 1) return null;
  }
  return { ...session, completed: [...new Set([...value.completed, ...session.completed])], answered: value.answered, recalled: value.recalled, assisted: value.assisted };
}

export function readPracticeProgress(game: SavedGame, study: PracticeStudy, side?: Side, storage?: ProgressStorage) {
  try {
    const entry = entries(storage ?? localStorage).find(entry => entry.id === game.id && entry.revision === librarySource(game).revision);
    if (!entry) return null;
    let chosen = side ?? entry.side;
    if (!practiceLineIndices(study, chosen).length) {
      if (side) return null;
      // Older clients could remember a color with no moves. Keep the valid
      // color's own saved session instead of copying or resetting its scores.
      chosen = study.side;
    }
    const session = restorePracticeSession(study, entry.sessions[chosen]);
    return session ? { side: chosen, session } : null;
  } catch { return null; }
}

export function writePracticeProgress(game: SavedGame, side: Side, session: PracticeSession, storage?: ProgressStorage): boolean {
  try {
    const target = storage ?? localStorage;
    let previous: Entry[];
    try { previous = entries(target); } catch { previous = []; }
    const revision = librarySource(game).revision;
    const existing = previous.find(entry => entry.id === game.id && entry.revision === revision);
    const { line, moves, completed, recalled, answered, assisted } = session;
    const next: Entry = { id: game.id, revision, side, updatedAt: Date.now(), sessions: { ...existing?.sessions,
      [side]: { line, moves, completed, recalled, answered, assisted } } };
    const rest = previous.filter(entry => entry.id !== game.id).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 49);
    let serialized = JSON.stringify([next, ...rest]);
    while (serialized.length > MAX_LENGTH && rest.length) { rest.pop(); serialized = JSON.stringify([next, ...rest]); }
    if (serialized.length > MAX_LENGTH) return false;
    target.setItem(PRACTICE_PROGRESS_KEY, serialized);
    return true;
  } catch { return false; }
}
