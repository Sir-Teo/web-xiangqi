import { legalMovesFrom, pieceSide, squareToUci, validateMoveStr, type BoardState, type Side } from './xiangqi';

export const MAX_CANDIDATE_MOVES = 5;

export function legalCandidateMoves(board: BoardState, side: Side): string[] {
  const moves: string[] = [];
  for (let rank = 0; rank < 10; rank++) for (let file = 0; file < 9; file++) {
    if (!board[rank][file] || pieceSide(board[rank][file]) !== side) continue;
    for (const target of legalMovesFrom(board, file, rank, side)) {
      moves.push(squareToUci(file, rank) + squareToUci(target.file, target.rank));
    }
  }
  return moves;
}

/** Validate the complete set before constructing the UCI root restriction. */
export function candidateGoCommand(go: string, moves: string[], board: BoardState, side: Side): string | null {
  if (!moves.length || moves.length > MAX_CANDIDATE_MOVES || new Set(moves).size !== moves.length) return null;
  if (!/^go(?: (?:depth|movetime|nodes) [1-9]\d*| infinite)+$/.test(go)) return null;
  if (moves.some(move => !/^[a-i][0-9][a-i][0-9]$/.test(move) || !validateMoveStr(move, board, side).ok)) return null;
  // The pinned Pikafish parser consumes the remainder of the line here.
  return `${go} searchmoves ${moves.join(' ')}`;
}

export function makeCandidateTag(key: string) { return `candidate|${key}`; }
export function parseCandidateTag(tag: string | null) {
  return tag?.startsWith('candidate|') && tag.length > 10 ? tag.slice(10) : null;
}

export type CandidateSearch = {
  requestKey: string;
  key: string;
  moves: string[];
  completed: boolean;
  budgetLabel: string;
};
