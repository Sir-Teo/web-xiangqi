import type { BoardState, Side } from './xiangqi';
export type EditorPosition = { board: BoardState; side: Side };
export type EditorHistory = { past: EditorPosition[]; present: EditorPosition; future: EditorPosition[] };
export type EditorAction = { type: 'edit'; update: (position: EditorPosition) => EditorPosition } | { type: 'undo' | 'redo' };
export function editorHistory(history: EditorHistory, action: EditorAction): EditorHistory {
  if (action.type === 'undo') {
    if (!history.past.length) return history;
    return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] };
  }
  if (action.type === 'redo') {
    if (!history.future.length) return history;
    return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
  }
  if (action.type !== 'edit') return history;
  const next = action.update(history.present);
  if (next.side === history.present.side && next.board.every((row, rank) => row.every((piece, file) => piece === history.present.board[rank][file]))) return history;
  return { past: [...history.past.slice(-99), history.present], present: next, future: [] };
}
