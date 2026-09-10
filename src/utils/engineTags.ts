/**
 * Every search the app starts carries a tag, and every reply the engine sends
 * carries it back. The tag is how a reply is matched to the request that asked
 * for it -- and, more to the point, how a reply to a request nobody wants any
 * more is dropped instead of drawn. Get the parsing wrong and the app shows a
 * stale evaluation, or plays a move chosen for a position that has since
 * changed.
 *
 * Split out of `App.tsx` because none of it is React and all of it is string
 * work with a round trip to prove. The five prefixes are distinct so that no
 * tag can be read as another kind: a threat search, in particular, is a search
 * of a *different* position -- the same board with the other side to move -- and
 * reading one as an analysis would put the opponent's evaluation on the eval bar
 * labelled as the position's own.
 */
import { isAiStrength, type AiStrength } from './aiOpponent';
import { START_FEN } from './xiangqi';

export const ANALYSIS_TAG_PREFIX = 'analysis';
export const AI_TAG_PREFIX = 'ai';
export const REVIEW_TAG_PREFIX = 'review';
export const THREAT_TAG_PREFIX = 'threat';
export const HINT_TAG_PREFIX = 'hint';

export type AnalysisPhase = 'primary' | 'deepen' | 'deep';
export type ReviewPhase = 'base' | 'revisit';

/**
 * The payload is always the last field and is rejoined rather than taken as one
 * split part, because a request key or a position command may itself contain a
 * `|`. A parser that took `split('|')[2]` would silently truncate it, and the
 * reply would then be dropped as belonging to no request -- a search that
 * appears to have simply never answered.
 */
export function makeAnalysisTag(phase: AnalysisPhase, requestKey: string) {
  return `${ANALYSIS_TAG_PREFIX}|${phase}|${requestKey}`;
}

export function parseAnalysisTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${ANALYSIS_TAG_PREFIX}|`)) return null;
  const [, phase, ...rest] = tag.split('|');
  if ((phase !== 'primary' && phase !== 'deepen' && phase !== 'deep') || rest.length === 0) return null;
  return { phase: phase as AnalysisPhase, requestKey: rest.join('|') };
}

export function makeReviewTag(phase: ReviewPhase, nodeId: string) {
  return `${REVIEW_TAG_PREFIX}|${phase}|${nodeId}`;
}

export function parseReviewTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${REVIEW_TAG_PREFIX}|`)) return null;
  const [, phase, ...rest] = tag.split('|');
  if ((phase !== 'base' && phase !== 'revisit') || rest.length === 0) return null;
  const nodeId = rest.join('|');
  return nodeId ? { phase, nodeId } : null;
}

/**
 * A threat search carries its own prefix so it cannot be mistaken for the
 * analysis of the position on screen. The request key inside it is still the
 * analysis one, so a threat is dropped by the same navigation that drops an
 * analysis.
 */
export function makeThreatTag(requestKey: string) {
  return `${THREAT_TAG_PREFIX}|${requestKey}`;
}

export function parseThreatTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${THREAT_TAG_PREFIX}|`)) return null;
  const requestKey = tag.slice(THREAT_TAG_PREFIX.length + 1);
  return requestKey ? { requestKey } : null;
}

/**
 * A hint is a search of the position the human is about to move in, during a
 * game against the engine -- where analysis is off, so nothing else is looking
 * at it. It carries the position command so a reply that arrives after the
 * position has changed is dropped rather than drawn.
 */
export function makeHintTag(positionCommand: string) {
  return `${HINT_TAG_PREFIX}|${positionCommand}`;
}

export function parseHintTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${HINT_TAG_PREFIX}|`)) return null;
  const positionCommand = tag.slice(HINT_TAG_PREFIX.length + 1);
  return positionCommand ? { positionCommand } : null;
}

export function makeAiTag(positionCommand: string, depth: number, strength: AiStrength) {
  return `${AI_TAG_PREFIX}|${depth}|${strength}|${positionCommand}`;
}

/**
 * The `position` command that tells the engine which board to think about.
 *
 * `startpos` rather than the full FEN whenever the root really is the opening
 * position with Red to move, because that is what every engine expects to see
 * and what its own logs and books are keyed on. Anything else -- a set-up
 * position, a loaded FEN, or the opening position with *Black* to move, which
 * is a different position -- goes as `position fen`.
 *
 * It lives beside the tags because the two travel together: this says which
 * position, the tag says which request, and getting either wrong shows a
 * reader an evaluation of a board that is not on their screen.
 */
export function makeEnginePositionCommand(rootFen: string, moves: string[]) {
  const rootParts = rootFen.trim().split(/\s+/);
  const isDefaultStart = rootParts[0] === START_FEN && rootParts[1] === 'w';
  const baseCommand = isDefaultStart ? 'position startpos' : `position fen ${rootFen}`;
  return moves.length > 0 ? `${baseCommand} moves ${moves.join(' ')}` : baseCommand;
}

export function parseAiTag(tag: string | null) {
  if (!tag || !tag.startsWith(`${AI_TAG_PREFIX}|`)) return null;
  const [, depthText, strengthText, ...rest] = tag.split('|');
  const depth = Number(depthText);
  const strength = Number(strengthText);
  const positionCommand = rest.join('|');
  if (!Number.isFinite(depth) || !isAiStrength(strength) || !positionCommand) return null;
  return { depth, strength, positionCommand };
}
