export type AiStrength = 1 | 2 | 3 | 4 | 5;

export type AiCandidateLine = {
  score: number;
  moves: string[];
  multipv?: number;
  searchTag: string | null;
};

export type AiMoveChoice = {
  move: string;
  score: number;
  source: 'bestmove' | 'pv';
  multipv?: number;
};

/**
 * The top of the AI opponent's strength ladder.
 *
 * This is a *game* setting -- how strong Master plays -- and it is deliberately
 * short of what the engine can do, because an opponent that searches as deep as
 * the analysis board is not an opponent anyone wants to play.
 *
 * It used to clamp live analysis too, through `safeSearchDepth` in App.tsx, so
 * the analysis board could never look deeper than the hardest opponent. The
 * analysis ceiling belongs to `resolveLiveAnalysisPolicy`, which sets it per
 * tier alongside the move-time budget it has to fit inside.
 */
export const WORKER_SAFE_MAX_DEPTH = 12;

export const AI_STRENGTH_LABELS: Record<AiStrength, string> = {
  1: 'Beginner',
  2: 'Easy',
  3: 'Medium',
  4: 'Hard',
  5: 'Master',
};

export const AI_DEPTH_LIMIT: Record<AiStrength, number> = {
  1: 2,
  2: 4,
  3: 6,
  4: 9,
  5: WORKER_SAFE_MAX_DEPTH,
};

const AI_MULTI_PV_LIMIT: Record<AiStrength, number> = {
  1: 5,
  2: 5,
  3: 3,
  4: 1,
  5: 1,
};

const AI_MAX_SCORE_DROP: Record<AiStrength, number> = {
  1: 500,
  2: 300,
  3: 140,
  4: 0,
  5: 0,
};

const AI_CANDIDATE_WEIGHTS: Record<AiStrength, number[]> = {
  1: [0.45, 0.25, 0.15, 0.1, 0.05],
  2: [0.64, 0.23, 0.09, 0.04, 0],
  3: [0.84, 0.13, 0.03, 0, 0],
  4: [1, 0, 0, 0, 0],
  5: [1, 0, 0, 0, 0],
};

export function isAiStrength(value: unknown): value is AiStrength {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function getAiSearchConfig(strength: AiStrength, safeDepth: number) {
  return {
    depth: Math.max(1, Math.min(safeDepth, AI_DEPTH_LIMIT[strength])),
    multiPv: AI_MULTI_PV_LIMIT[strength],
  };
}

export function describeAiStrength(strength: AiStrength) {
  const config = getAiSearchConfig(strength, WORKER_SAFE_MAX_DEPTH);
  const candidates = config.multiPv === 1 ? 'best move only' : `up to ${config.multiPv} candidate moves`;
  return `${AI_STRENGTH_LABELS[strength]}: depth ${config.depth}, ${candidates}`;
}

function isUciMove(move: string) {
  return /^[a-i][0-9][a-i][0-9]$/i.test(move);
}

export function chooseAiMoveFromPv({
  fallbackMove,
  fallbackScore,
  pvLines,
  searchTag,
  strength,
  random = Math.random,
}: {
  fallbackMove: string;
  fallbackScore: number;
  pvLines: AiCandidateLine[];
  searchTag: string | null;
  strength: AiStrength;
  random?: () => number;
}): AiMoveChoice {
  const fallback = {
    move: fallbackMove,
    score: fallbackScore,
    source: 'bestmove' as const,
  };

  const fallbackIsValid = isUciMove(fallbackMove);
  const candidateLimit = AI_MULTI_PV_LIMIT[strength];
  if (fallbackIsValid && candidateLimit <= 1) {
    return fallback;
  }

  const matchingLines = pvLines
    .filter((line) => !searchTag || line.searchTag === searchTag)
    .filter((line) => isUciMove(line.moves[0] || ''))
    .sort((a, b) => (a.multipv ?? 0) - (b.multipv ?? 0));

  const candidates: AiMoveChoice[] = [];
  const seenMoves = new Set<string>();
  const primaryScore = matchingLines[0]?.score ?? fallbackScore;
  const maxDrop = AI_MAX_SCORE_DROP[strength];

  for (const line of matchingLines) {
    const move = line.moves[0];
    if (seenMoves.has(move)) continue;
    const scoreDrop = Math.max(0, primaryScore - line.score);
    if (candidates.length > 0 && scoreDrop > maxDrop) continue;
    seenMoves.add(move);
    candidates.push({
      move,
      score: line.score,
      source: 'pv',
      multipv: line.multipv,
    });
    if (candidates.length >= candidateLimit) break;
  }

  if (candidates.length <= 1) return candidates[0] ?? fallback;

  const weights = AI_CANDIDATE_WEIGHTS[strength];
  const candidateWeights = candidates.map((_, index) => Math.max(0, weights[index] ?? 0));
  const totalWeight = candidateWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return candidates[0];

  let threshold = Math.max(0, Math.min(0.999999, random())) * totalWeight;
  for (let index = 0; index < candidates.length; index += 1) {
    threshold -= candidateWeights[index];
    if (threshold <= 0) return candidates[index];
  }

  return candidates[candidates.length - 1];
}
