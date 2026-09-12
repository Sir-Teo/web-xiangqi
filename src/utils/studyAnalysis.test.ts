import { describe, expect, it } from 'vitest';
import { captureStudyAnalysis, normalizeStudyAnalysis, sameStudyAnalysis, studyAnalysisScore, studyAnalysisPgn, readStudyAnalysisPgn } from './studyAnalysis';
import { exportPgnFromMoveTree } from './gameExport';
import { extractUciMoveTree, extractAnnotatedMainLine } from './moveImport';
import { parsePgnCollection } from './pgnCollection';
import { encodeSavedMoveTreeParam, decodeSavedMoveTreeParam } from './shareTree';
import { normalizeSavedMoveTree } from './gameLibrary';

const engine = { name: 'Pikafish 测试', variant: 'single-simd', threads: 1, hashMB: 64 };
const pv = { depth: '18', score: 125, scoreStr: '+125', moves: ['a9a8', 'a0a1'], searchTag: null };
const snapshot = () => captureStudyAnalysis(pv, 'b', 'position startpos moves h2e2', engine, 2, ['a9a8', 'i9i8'])!;

describe('saved study analysis', () => {
  it('captures source context and Red perspective without assigning a move evaluation', () => {
    const a = snapshot();
    expect(a.score).toBe(-125);
    expect(a.position).toBe('position startpos moves h2e2');
    expect(studyAnalysisScore(a)).toBe('-1.25');
    expect(a.candidates).toEqual(['a9a8', 'i9i8']);
    expect(a).not.toHaveProperty('evalScore');
  });
  it('distinguishes mate, centipawn and bounded scores', () => {
    const mate = captureStudyAnalysis({ ...pv, score: 29997, scoreStr: '+M3', bounded: true }, 'b', 'position startpos', engine, 1)!;
    expect(studyAnalysisScore(mate)).toBe('-M3');
    expect(mate.bounded).toBe(true);
    expect(mate).not.toHaveProperty('bound');
    expect(snapshot().scoreKind).toBe('cp');
    expect(studyAnalysisScore({ ...mate, score: -30000 })).toBe('-M0');
    expect(studyAnalysisScore({ ...mate, score: 30000 })).toBe('+M0');
  });
  it('rejects wrong contexts, malformed or unbounded metadata while whitelisting fields', () => {
    const a = snapshot();
    expect(normalizeStudyAnalysis(a, 'position startpos', a.move)).toBeUndefined();
    expect(normalizeStudyAnalysis(a, a.position, 'i9i8')).toBeUndefined();
    for (const patch of [{ depth: 999 }, { score: Infinity }, { savedAt: NaN }, { candidates: ['a9a8', 'a9a8'] }, { multiPv: 5 }, { position: 'position startpos\nquit' }, { version: 2 }, { bound: 'sideways' }, { bounded: false, bound: 'lower' }, { engine: { ...engine, name: 'x'.repeat(121) } }]) {
      expect(normalizeStudyAnalysis({ ...a, ...patch })).toBeUndefined();
    }
    expect(normalizeStudyAnalysis({ ...a, extra: 'discard', engine: { ...engine, extra: 'discard' } })).toEqual(a);
  });
  it('recognizes identical analysis independent of capture time, and detects new depth or scope', () => {
    const a = snapshot();
    expect(sameStudyAnalysis(a, { ...a, savedAt: a.savedAt + 1 })).toBe(true);
    expect(sameStudyAnalysis(a, { ...a, depth: 20 })).toBe(false);
    expect(sameStudyAnalysis(a, { ...a, candidates: undefined })).toBe(false);
    const bounded = { ...a, bounded: true, bound: 'lower' as const };
    expect(sameStudyAnalysis(bounded, { ...bounded, bound: 'upper' })).toBe(false);
    expect(sameStudyAnalysis(bounded, { ...bounded, bound: undefined })).toBe(false);
  });
  it('retains deep-search snapshots throughout the pinned engine depth range', () => {
    // The pinned Pikafish has MAX_PLY 246, allowing root searches through 245.
    for (const depth of [129, 245, 256]) {
      const a = captureStudyAnalysis({ ...pv, depth: String(depth) }, 'b', 'position startpos', engine, 1)!;
      expect(a.depth).toBe(depth);
      expect(readStudyAnalysisPgn(studyAnalysisPgn(a)!)).toEqual(a);
    }
    expect(normalizeStudyAnalysis({ ...snapshot(), depth: 257 })).toBeUndefined();
  });
  it('round-trips the snapshot through PGN comments without creating an eval command', () => {
    const a = snapshot();
    const command = studyAnalysisPgn(a)!;
    expect(command).not.toMatch(/[{}]/);
    expect(command).not.toContain('[%eval');
    expect(readStudyAnalysisPgn(command)).toEqual(a);
    expect(readStudyAnalysisPgn('[%xqanalysis %invalid]')).toBeUndefined();
    const tree = [{ uci: 'h2e2', children: [{ uci: 'a9a8', analysis: a }, { uci: 'i9i8', analysis: { ...a, move: 'i9i8' } }] }];
    const pgn = exportPgnFromMoveTree(tree, { date: '2026.09.11' })!;
    expect(extractUciMoveTree(pgn).moveTree).toEqual(tree);
    expect(extractAnnotatedMainLine(pgn).annotations.every(annotation => annotation.evalScore === undefined)).toBe(true);
  });
  it('captures directional bounds in Red perspective and preserves them through study formats', () => {
    for (const bound of ['lower', 'upper'] as const) {
      const boundedPv = { ...pv, bounded: true, bound };
      const a = captureStudyAnalysis(boundedPv, 'b', 'position startpos moves h2e2', engine, 1)!;
      expect(a.bound).toBe(bound === 'lower' ? 'upper' : 'lower');
      expect(a.score).toBe(-125);
      expect(captureStudyAnalysis(boundedPv, 'w', 'position startpos', engine, 1)?.bound).toBe(bound);
      expect(readStudyAnalysisPgn(studyAnalysisPgn(a)!)).toEqual(a);
      const tree = [{ uci: 'h2e2', children: [{ uci: 'a9a8', analysis: a }] }];
      expect(normalizeSavedMoveTree(tree)).toEqual(tree);
      expect(decodeSavedMoveTreeParam(encodeSavedMoveTreeParam(tree))).toEqual(tree);
      expect(extractUciMoveTree(exportPgnFromMoveTree(tree)!).moveTree).toEqual(tree);
      expect(parsePgnCollection(exportPgnFromMoveTree(tree)!)).toMatchObject([{ moveTree: tree }]);
    }
  });
  it('preserves snapshots in library normalization, sharing, and collection import', () => {
    const a = snapshot();
    const tree = [{ uci: 'h2e2', children: [{ uci: 'a9a8', analysis: a }] }];
    expect(normalizeSavedMoveTree(tree)).toEqual(tree);
    expect(decodeSavedMoveTreeParam(encodeSavedMoveTreeParam(tree))).toEqual(tree);
    const collection = parsePgnCollection(exportPgnFromMoveTree(tree)!);
    expect(collection).toMatchObject([{ moveTree: tree }]);
  });
});
