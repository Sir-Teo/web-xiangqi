import { MAX_SAVED_MOVES, MAX_SAVED_TREE_NODES, type SavedGame, type SavedMoveTreeNode } from './gameLibrary';
import { describeSetupProblem } from './positionSetup';
import { formatMoveRuleHint } from './moveRuleHints';
import { normalizeMoveComment } from './moveComment';
import { START_POSITION_FEN, cloneBoardState, otherSide, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';

export interface PracticeStudyNote { ply: number; move?: string; comment: string }
interface PracticeTrie { children: Map<string, PracticeTrie>; parent?: PracticeTrie; line?: number; firstLine: number }
interface PracticePath { move: string; parent?: PracticePath; note?: PracticeStudyNote; length: number }

/** Equivalent move lines share an exercise, while each occurrence can explain it. */
function notesForPaths(paths: PracticePath[], rootNotes: PracticeStudyNote[]): PracticeStudyNote[] {
  const visited = new Set<PracticePath>();
  const seen = new Map<number, Set<string>>();
  const notes: PracticeStudyNote[] = [];
  for (const path of paths) {
    for (let node: PracticePath | undefined = path; node && !visited.has(node); node = node.parent) {
      visited.add(node);
      if (!node.note) continue;
      const { ply, comment } = node.note;
      let comments = seen.get(ply);
      if (!comments) { comments = new Set(); seen.set(ply, comments); }
      if (!comments.has(comment)) { comments.add(comment); notes.push(node.note); }
    }
  }
  // Walk shared prefixes once, then present notes in move order. Stable sorting
  // keeps different explanations at the same ply in their saved tree order.
  return [...rootNotes, ...notes.sort((a, b) => a.ply - b.ply)];
}
export interface PracticeStudy {
  board: BoardState; side: Side;
  /** Only the currently requested line is materialized; prefixes stay shared. */
  lines: string[][]; notes: PracticeStudyNote[][];
  lineLengths: number[]; root: PracticeTrie;
}
export interface PracticeSession {
  board: BoardState;
  side: Side;
  line: number;
  moves: string[];
  completed: number[];
  recalled: number;
  answered: number;
  assisted: boolean;
}

function movedBoard(board: BoardState, uci: string, side: Side): BoardState | null {
  const checked = validateMoveStr(uci, board, side);
  if (!checked.ok || !checked.mv) return null;
  const result = cloneBoardState(board);
  const { fromFile, fromRank, toFile, toRank } = checked.mv;
  result[toRank][toFile] = result[fromRank][fromFile]; result[fromRank][fromFile] = '';
  return result;
}

/** Validate the entire saved tree before teaching it; never silently drop a branch. */
export function preparePracticeStudy(game: SavedGame): { study: PracticeStudy | null; error: string | null } {
  const fail = (error: string) => ({ study: null, error });
  try {
    const fen = game.startFen || START_POSITION_FEN;
    const board = parseFenBoard(fen);
    const side = fen.trim().split(/\s+/)[1];
    if (side !== 'w' && side !== 'b') return fail('The saved starting side is invalid.');
    const problem = describeSetupProblem(board, side);
    if (problem) return fail(problem);
    let roots = game.moveTree;
    if (!roots?.length) {
      if (game.moves.length > MAX_SAVED_MOVES) return fail('This line has too many moves to practice.');
      roots = [];
      for (let i = game.moves.length - 1; i >= 0; i--) roots = [{ uci: game.moves[i], children: roots }];
    }
    if (!roots.length) return fail('Save a game or variation with moves to practice it.');
    const root: PracticeTrie = { children: new Map(), firstLine: Infinity };
    const trieNodes = [root];
    const ends = new Map<PracticeTrie, PracticePath[]>();
    const rootComment = normalizeMoveComment(game.rootComment);
    const rootNotes: PracticeStudyNote[] = rootComment ? [{ ply: 0, comment: rootComment }] : [];
    const ancestors = new Set<SavedMoveTreeNode>();
    const stack: Array<{ nodes: SavedMoveTreeNode[]; index: number; board: BoardState; side: Side;
      owner?: SavedMoveTreeNode; path?: PracticePath; trie: PracticeTrie }> = [
      { nodes: roots, index: 0, board, side, trie: root },
    ];
    let visited = 0;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index === frame.nodes.length) {
        stack.pop();
        if (frame.owner) ancestors.delete(frame.owner);
        continue;
      }
      const node = frame.nodes[frame.index++];
      const depth = (frame.path?.length ?? 0) + 1;
      if (depth > MAX_SAVED_MOVES) return fail('This line has too many moves to practice.');
      if (++visited > MAX_SAVED_TREE_NODES || ancestors.has(node)) return fail('This study has too many moves or a circular variation.');
      const next = movedBoard(frame.board, node.uci, frame.side);
      if (!next) return fail(`Saved move ${node.uci} at ply ${depth} is illegal. Correct the study before practicing.`);
      const comment = normalizeMoveComment(node.comment);
      const path: PracticePath = { move: node.uci, parent: frame.path, length: depth,
        note: comment ? { ply: depth, move: node.uci, comment } : undefined };
      let trie = frame.trie.children.get(node.uci);
      if (!trie) {
        trie = { children: new Map(), parent: frame.trie, firstLine: Infinity };
        frame.trie.children.set(node.uci, trie); trieNodes.push(trie);
      }
      if (node.children?.length) {
        ancestors.add(node);
        stack.push({ nodes: node.children, index: 0, board: next, side: otherSide(frame.side), owner: node, path, trie });
      } else {
        const paths = ends.get(trie);
        if (paths) paths.push(path); else ends.set(trie, [path]);
      }
    }
    const leaves = [...ends.values()];
    [...ends.keys()].forEach((trie, index) => { trie.line = index; trie.firstLine = index; });
    // A subtree's earliest line lets matching prune unrelated continuations.
    for (let i = trieNodes.length - 1; i > 0; i--) {
      const node = trieNodes[i];
      node.parent!.firstLine = Math.min(node.parent!.firstLine, node.firstLine);
    }
    let cachedIndex = -1;
    let cachedMoves: string[] = [];
    let cachedNotes: PracticeStudyNote[] = [];
    const materialize = (index: number) => {
      if (cachedIndex === index) return;
      const path: PracticePath[] = [];
      for (let node: PracticePath | undefined = leaves[index][0]; node; node = node.parent) path.push(node);
      path.reverse();
      cachedMoves = path.map(node => node.move);
      cachedNotes = notesForPaths(leaves[index], rootNotes);
      cachedIndex = index;
    };
    const lines: string[][] = new Array(leaves.length);
    const notes: PracticeStudyNote[][] = new Array(leaves.length);
    leaves.forEach((_, index) => {
      Object.defineProperty(lines, index, { enumerable: true, configurable: true, get: () => { materialize(index); return cachedMoves; } });
      Object.defineProperty(notes, index, { enumerable: true, configurable: true, get: () => { materialize(index); return cachedNotes; } });
    });
    return { study: { board, side, lines, notes, lineLengths: leaves.map(paths => paths[0].length), root }, error: null };
  } catch { return fail('This saved study could not be read. Load and correct it before practicing.'); }
}

export function practiceLineIndices(study: PracticeStudy, side: Side): number[] {
  return study.lineLengths.flatMap((length, index) => side === study.side || length > 1 ? [index] : []);
}

export function startPracticeLine(study: PracticeStudy, line: number, previous?: PracticeSession): PracticeSession {
  return { board: cloneBoardState(study.board), side: study.side, line, moves: [],
    completed: previous?.completed ?? [], recalled: previous?.recalled ?? 0,
    answered: previous?.answered ?? 0, assisted: false };
}

export function practiceComplete(study: PracticeStudy, session: PracticeSession): boolean {
  return session.moves.length === study.lineLengths[session.line];
}

function advance(study: PracticeStudy, session: PracticeSession, uci: string, line: number): PracticeSession {
  const board = movedBoard(session.board, uci, session.side);
  if (!board) return session;
  const moves = [...session.moves, uci];
  const completed = moves.length === study.lineLengths[line]
    ? [...new Set([...session.completed, line])] : session.completed;
  return { ...session, board, side: otherSide(session.side), moves, line, completed, assisted: false };
}

export function attemptPracticeMove(study: PracticeStudy, session: PracticeSession, side: Side, uci: string) {
  if (session.side !== side || practiceComplete(study, session)) return { session, message: 'Play the saved reply or start another line.', matched: false };
  const checked = validateMoveStr(uci, session.board, side);
  if (!checked.ok) return { session, message: formatMoveRuleHint(checked.reason), matched: false };
  let branch: PracticeTrie | undefined = study.root;
  for (const move of session.moves) branch = branch?.children.get(move);
  branch = branch?.children.get(uci);
  if (!branch) return { session: { ...session, assisted: true }, matched: false,
    message: 'That move is legal, but outside this study. Try a saved continuation or ask for a hint.' };
  let line = session.line;
  if (study.lines[line]?.[session.moves.length] !== uci) {
    const completed = new Set(session.completed);
    let firstUncompleted = Infinity;
    const pending = [branch];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.firstLine >= firstUncompleted) continue;
      if (node.line !== undefined && !completed.has(node.line)) firstUncompleted = Math.min(firstUncompleted, node.line);
      pending.push(...node.children.values());
    }
    line = Number.isFinite(firstUncompleted) ? firstUncompleted : branch.firstLine;
  }
  const next = advance(study, session, uci, line);
  return { session: { ...next, answered: session.answered + 1, recalled: session.recalled + (session.assisted ? 0 : 1) },
    message: 'That move is in your study.', matched: true };
}

export function playPracticeReply(study: PracticeStudy, session: PracticeSession, side: Side): PracticeSession {
  if (session.side === side || practiceComplete(study, session)) return session;
  return advance(study, session, study.lines[session.line][session.moves.length], session.line);
}

export function nextPracticeLine(study: PracticeStudy, session: PracticeSession, side: Side): number | undefined {
  const eligible = practiceLineIndices(study, side);
  const start = eligible.indexOf(session.line);
  const ordered = [...eligible.slice(start + 1), ...eligible.slice(0, start + 1)];
  return ordered.find(index => !session.completed.includes(index)) ?? ordered[0];
}
