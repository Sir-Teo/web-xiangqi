import type { SavedGame } from './gameLibrary';
import { PRACTICE_PROGRESS_KEY, MAX_PRACTICE_PROGRESS_LENGTH, readPracticeEntries, practiceRevision, matchesPracticeRevision,
  type PracticeProgressEntry, type PracticeProgressStorage } from './practiceProgressStore';
import { playPracticeReply, practiceLineIndices, startPracticeLine, type PracticeSession, type PracticeStudy } from './studyPractice';
import type { Side } from './xiangqi';

export { PRACTICE_PROGRESS_KEY } from './practiceProgressStore';

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

export function readPracticeProgress(game: SavedGame, study: PracticeStudy, side?: Side, storage?: PracticeProgressStorage) {
  try {
    const entry = readPracticeEntries(storage ?? localStorage).find(entry => entry.id === game.id && matchesPracticeRevision(game, entry.revision));
    if (!entry) return null;
    let chosen = side ?? entry.side;
    let eligible = practiceLineIndices(study, chosen);
    if (!eligible.length) {
      if (side) return null;
      // Older clients could remember a color with no moves. Keep the valid
      // color's own saved session instead of copying or resetting its scores.
      chosen = study.side;
      eligible = practiceLineIndices(study, chosen);
    }
    let session = restorePracticeSession(study, entry.sessions[chosen]);
    if (session && !eligible.includes(session.line)) {
      // Older progress can select an opponent-only line in a mixed study.
      // Resume a playable exercise while retaining this side's own history.
      const completed = new Set(session.completed);
      const next = eligible.find(line => !completed.has(line)) ?? eligible[0];
      session = startPracticeLine(study, next, session);
    }
    return session ? { side: chosen, session } : null;
  } catch { return null; }
}

export function writePracticeProgress(game: SavedGame, side: Side, session: PracticeSession, storage?: PracticeProgressStorage): boolean {
  try {
    const target = storage ?? localStorage;
    let previous: PracticeProgressEntry[];
    try { previous = readPracticeEntries(target); } catch { previous = []; }
    const revision = practiceRevision(game);
    const existing = previous.find(entry => entry.id === game.id && matchesPracticeRevision(game, entry.revision));
    const { line, moves, completed, recalled, answered, assisted } = session;
    const next: PracticeProgressEntry = { id: game.id, revision, side, updatedAt: Date.now(), sessions: { ...existing?.sessions,
      [side]: { line, moves, completed, recalled, answered, assisted } } };
    const rest = previous.filter(entry => entry.id !== game.id).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 49);
    let serialized = JSON.stringify([next, ...rest]);
    while (serialized.length > MAX_PRACTICE_PROGRESS_LENGTH && rest.length) { rest.pop(); serialized = JSON.stringify([next, ...rest]); }
    if (serialized.length > MAX_PRACTICE_PROGRESS_LENGTH) return false;
    target.setItem(PRACTICE_PROGRESS_KEY, serialized);
    return true;
  } catch { return false; }
}
