import { MAX_SAVED_TREE_NODES, type SavedGame, type SavedMoveTreeNode } from './gameLibrary';
import { describeSetupProblem } from './positionSetup';
import { formatMoveRuleHint } from './moveRuleHints';
import { START_POSITION_FEN, cloneBoardState, otherSide, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';

export interface PracticeStudy { board: BoardState; side: Side; lines: string[][] }
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
      if (game.moves.length > MAX_SAVED_TREE_NODES) return fail('This study has too many moves to practice.');
      roots = [];
      for (let i = game.moves.length - 1; i >= 0; i--) roots = [{ uci: game.moves[i], children: roots }];
    }
    if (!roots.length) return fail('Save a game or variation with moves to practice it.');
    const lines: string[][] = [];
    const path: string[] = [];
    const ancestors = new Set<SavedMoveTreeNode>();
    const stack: Array<{ nodes: SavedMoveTreeNode[]; index: number; board: BoardState; side: Side; owner?: SavedMoveTreeNode }> = [
      { nodes: roots, index: 0, board, side },
    ];
    let visited = 0;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index === frame.nodes.length) {
        stack.pop();
        if (frame.owner) { ancestors.delete(frame.owner); path.pop(); }
        continue;
      }
      const node = frame.nodes[frame.index++];
      if (++visited > MAX_SAVED_TREE_NODES || ancestors.has(node)) return fail('This study has too many moves or a circular variation.');
      const next = movedBoard(frame.board, node.uci, frame.side);
      if (!next) return fail(`Saved move ${node.uci} at ply ${path.length + 1} is illegal. Correct the study before practicing.`);
      path.push(node.uci);
      if (node.children?.length) {
        ancestors.add(node);
        stack.push({ nodes: node.children, index: 0, board: next, side: otherSide(frame.side), owner: node });
      } else { lines.push([...path]); path.pop(); }
    }
    const unique = [...new Map(lines.map(line => [line.join(' '), line])).values()];
    return { study: { board, side, lines: unique }, error: null };
  } catch { return fail('This saved study could not be read. Load and correct it before practicing.'); }
}

export function practiceLineIndices(study: PracticeStudy, side: Side): number[] {
  return study.lines.flatMap((line, index) => side === study.side || line.length > 1 ? [index] : []);
}

export function startPracticeLine(study: PracticeStudy, line: number, previous?: PracticeSession): PracticeSession {
  return { board: cloneBoardState(study.board), side: study.side, line, moves: [],
    completed: previous?.completed ?? [], recalled: previous?.recalled ?? 0,
    answered: previous?.answered ?? 0, assisted: false };
}

export function practiceComplete(study: PracticeStudy, session: PracticeSession): boolean {
  return session.moves.length === study.lines[session.line]?.length;
}

function advance(study: PracticeStudy, session: PracticeSession, uci: string, line: number): PracticeSession {
  const board = movedBoard(session.board, uci, session.side);
  if (!board) return session;
  const moves = [...session.moves, uci];
  const completed = moves.length === study.lines[line].length
    ? [...new Set([...session.completed, line])] : session.completed;
  return { ...session, board, side: otherSide(session.side), moves, line, completed, assisted: false };
}

export function attemptPracticeMove(study: PracticeStudy, session: PracticeSession, side: Side, uci: string) {
  if (session.side !== side || practiceComplete(study, session)) return { session, message: 'Play the saved reply or start another line.', matched: false };
  const checked = validateMoveStr(uci, session.board, side);
  if (!checked.ok) return { session, message: formatMoveRuleHint(checked.reason), matched: false };
  const candidates = study.lines.flatMap((line, index) => line[session.moves.length] === uci
    && session.moves.every((move, ply) => line[ply] === move) ? [index] : []);
  if (!candidates.length) return { session: { ...session, assisted: true }, matched: false,
    message: 'That move is legal, but outside this study. Try a saved continuation or ask for a hint.' };
  const line = candidates.includes(session.line) ? session.line
    : candidates.find(index => !session.completed.includes(index)) ?? candidates[0];
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
