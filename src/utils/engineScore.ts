/**
 * The engine speaks from the side to move; the board speaks from Red. Every
 * number the reader sees -- the eval bar, the chips, each candidate line's
 * score, the win/draw/loss split -- has to cross that boundary exactly once.
 *
 * Crossing it twice, or not at all, is the whole failure mode: nothing throws,
 * nothing looks broken, and the app confidently shows the losing side ahead.
 * Split out of `App.tsx` so the crossing can be tested directly rather than by
 * reading a rendered eval bar and hoping.
 */
import type { Side } from './xiangqi';

/** Win/draw/loss from the perspective of whoever the engine was speaking for. */
export type EngineWdl = { win: number; draw: number; loss: number };

export function sideFromFen(fen: string): Side {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

export function normalizeEvalForSide(score: number, side: Side) {
  return side === 'b' ? -score : score;
}

export function normalizeEvalForFen(score: number, fen: string) {
  return normalizeEvalForSide(score, sideFromFen(fen));
}

/** Win and loss swap with the perspective; a draw is a draw from either chair. */
export function normalizeWdlForSide<T extends EngineWdl | null>(stats: T, side: Side): T {
  if (!stats || side === 'w') return stats;
  return { win: stats.loss, draw: stats.draw, loss: stats.win } as T;
}

export function formatEvalScore(score: number, decimals = 1) {
  return `${score > 0 ? '+' : ''}${(score / 100).toFixed(decimals)}`;
}

export function parseMateScoreText(scoreStr: string | undefined) {
  const match = scoreStr?.match(/^([+-])M(\d+)$/);
  if (!match) return null;
  const distance = Number(match[2]);
  if (!Number.isFinite(distance)) return null;
  return match[1] === '-' ? -distance : distance;
}

export function formatMateScoreText(distance: number) {
  return distance >= 0 ? `+M${distance}` : `-M${Math.abs(distance)}`;
}

/**
 * A candidate line's score as Red sees it. Mate has to be handled apart from
 * centipawns because it is carried as text rather than as a number, and because
 * flipping it means flipping who is being mated -- not negating a quantity.
 */
export function formatRedPovEngineScore(
  pv: { score: number; scoreStr?: string },
  side: Side,
  decimals = 1,
) {
  const mateDistance = parseMateScoreText(pv.scoreStr);
  if (mateDistance !== null) {
    const redPovMateDistance = side === 'b' ? -mateDistance : mateDistance;
    return formatMateScoreText(redPovMateDistance);
  }
  return formatEvalScore(normalizeEvalForSide(pv.score, side), decimals);
}
