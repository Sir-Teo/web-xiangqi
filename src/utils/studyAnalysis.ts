import type { EngineSearchEffort, PvLine } from '../hooks/useEngine';
import { normalizeEvalForSide, formatRedPovEngineScore, normalizeScoreBoundForSide, type ScoreBound } from './engineScore';
import type { Side } from './xiangqi';

/** A saved observation of the position BEFORE the attached move, never a move grade. */
export type StudyAnalysis = {
  version: 1;
  position: string;
  move: string;
  score: number; // Red-positive centipawns, with the existing mate sentinel.
  scoreKind: 'cp' | 'mate';
  bounded: boolean;
  /** Red-perspective direction. Older bounded snapshots may not include it. */
  bound?: ScoreBound;
  depth: number;
  savedAt: number;
  engine: { name: string; variant: string; threads: number; hashMB: number };
  multiPv: number;
  /** Whole-search counters reported alongside this reading, not per-candidate work. */
  effort?: EngineSearchEffort;
  candidates?: string[];
};
const MOVE = /^[a-i][0-9][a-i][0-9]$/;
// Storage bound, not a search setting. The pinned engine's MAX_PLY is 246;
// its iterative deepening can legitimately report depths above 128.
const MAX_SNAPSHOT_DEPTH = 256;
const POSITION = /^position (?:startpos|fen [^\r\n]{10,120}?)(?: moves(?: [a-i][0-9][a-i][0-9]){1,1024})?$/;
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n]/.test(value) && !value.includes('\0');

export function normalizeStudyAnalysis(value: unknown, position?: string, move?: string): StudyAnalysis | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const a = value as StudyAnalysis;
  if (a.version !== 1 || !text(a.position, 5300) || !POSITION.test(a.position)
    || !text(a.move, 4) || !MOVE.test(a.move) || (position !== undefined && a.position !== position)
    || (move !== undefined && a.move !== move) || !integer(a.score, -1000000, 1000000)
    || (a.scoreKind !== 'cp' && a.scoreKind !== 'mate') || typeof a.bounded !== 'boolean'
    || !integer(a.depth, 1, MAX_SNAPSHOT_DEPTH) || !integer(a.savedAt, 0, 8640000000000000)
    || !integer(a.multiPv, 1, 5) || !a.engine || typeof a.engine !== 'object'
    || !text(a.engine.name, 120) || !text(a.engine.variant, 32)
    || !integer(a.engine.threads, 1, 128) || !integer(a.engine.hashMB, 1, 65536)) return undefined;
  let effort: EngineSearchEffort | undefined;
  if (a.effort !== undefined) {
    if (!a.effort || typeof a.effort !== 'object' || Array.isArray(a.effort)) return undefined;
    const { nodes, timeMs, seldepth } = a.effort;
    if ((nodes !== undefined && !integer(nodes, 0, Number.MAX_SAFE_INTEGER))
      || (timeMs !== undefined && !integer(timeMs, 0, Number.MAX_SAFE_INTEGER))
      || (seldepth !== undefined && !integer(seldepth, 0, MAX_SNAPSHOT_DEPTH))) return undefined;
    if (nodes !== undefined || timeMs !== undefined || seldepth !== undefined) effort = {
      ...(nodes !== undefined ? { nodes } : {}), ...(timeMs !== undefined ? { timeMs } : {}),
      ...(seldepth !== undefined ? { seldepth } : {}),
    };
  }
  if (a.scoreKind === 'mate' && (Math.abs(a.score) < 15000 || Math.abs(a.score) > 30000)) return undefined;
  if (a.bound !== undefined && (!a.bounded || (a.bound !== 'lower' && a.bound !== 'upper'))) return undefined;
  if (a.candidates !== undefined && (!Array.isArray(a.candidates) || !a.candidates.length || a.candidates.length > 5
    || new Set(a.candidates).size !== a.candidates.length || !a.candidates.every(m => typeof m === 'string' && MOVE.test(m))
    || !a.candidates.includes(a.move) || a.candidates.length !== a.multiPv)) return undefined;
  return { version: 1, position: a.position, move: a.move, score: a.score, scoreKind: a.scoreKind,
    bounded: a.bounded, depth: a.depth, savedAt: a.savedAt, engine: { name: a.engine.name, variant: a.engine.variant, threads: a.engine.threads, hashMB: a.engine.hashMB }, multiPv: a.multiPv,
    ...(effort ? { effort } : {}), ...(a.bound ? { bound: a.bound } : {}), ...(a.candidates ? { candidates: [...a.candidates] } : {}) };
}

export function captureStudyAnalysis(pv: PvLine, side: Side, position: string, engine: StudyAnalysis['engine'], multiPv: number, candidates?: string[]): StudyAnalysis | undefined {
  return normalizeStudyAnalysis({ version: 1, position, move: pv.moves[0], score: normalizeEvalForSide(pv.score, side),
    scoreKind: /^[+-]M\d+$/.test(pv.scoreStr) ? 'mate' : 'cp', bounded: Boolean(pv.bounded), depth: Number(pv.depth),
    ...(pv.bounded && pv.bound ? { bound: normalizeScoreBoundForSide(pv.bound, side) } : {}),
    savedAt: Date.now(), engine, multiPv, ...(pv.effort ? { effort: pv.effort } : {}), ...(candidates ? { candidates } : {}) });
}

export function sameStudyAnalysis(a: StudyAnalysis | undefined, b: StudyAnalysis | undefined) {
  if (!a || !b) return a === b;
  return a.position === b.position && a.move === b.move && a.score === b.score && a.scoreKind === b.scoreKind
    && a.bounded === b.bounded && a.bound === b.bound && a.depth === b.depth && a.multiPv === b.multiPv
    && a.engine.name === b.engine.name && a.engine.variant === b.engine.variant
    && a.engine.threads === b.engine.threads && a.engine.hashMB === b.engine.hashMB
    && a.effort?.nodes === b.effort?.nodes && a.effort?.timeMs === b.effort?.timeMs
    && a.effort?.seldepth === b.effort?.seldepth
    && (a.candidates?.join(' ') ?? '') === (b.candidates?.join(' ') ?? '');
}

export function studyAnalysisScore(a: StudyAnalysis) {
  const scoreStr = a.scoreKind === 'mate' ? `${a.score < 0 ? '-' : '+'}M${30000 - Math.abs(a.score)}` : String(a.score);
  return formatRedPovEngineScore({ score: a.score, scoreStr }, 'w', 2);
}

export function studyAnalysisEffort(a: StudyAnalysis): string {
  const parts: string[] = [];
  if (a.effort?.nodes !== undefined) parts.push(`${a.effort.nodes.toLocaleString()} nodes`);
  if (a.effort?.timeMs !== undefined) parts.push(`${a.effort.timeMs.toLocaleString()} ms`);
  if (a.effort?.seldepth !== undefined) parts.push(`selective depth ${a.effort.seldepth}`);
  return parts.join(' · ') || 'Not recorded';
}

export function studyAnalysisPgn(a: StudyAnalysis | undefined): string | undefined {
  const normalized = normalizeStudyAnalysis(a);
  return normalized ? `[%xqanalysis ${encodeURIComponent(JSON.stringify(normalized))}]` : undefined;
}

export function readStudyAnalysisPgn(comment: string): StudyAnalysis | undefined {
  const match = /\[%xqanalysis ([^\]\s]{1,18000})\]/.exec(comment);
  if (!match) return undefined;
  try { return normalizeStudyAnalysis(JSON.parse(decodeURIComponent(match[1]))); } catch { return undefined; }
}
