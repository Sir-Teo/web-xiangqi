import { expect, it } from 'vitest';
import { editorHistory, type EditorHistory } from './editorHistory';
import { START_FEN, parseFenBoard } from './xiangqi';
it('undoes and redoes an atomic position load, then drops redo after a new edit', () => {
  const first: EditorHistory = { past: [], present: { board: parseFenBoard(START_FEN), side: 'w' }, future: [] };
  const changed = editorHistory(first, { type: 'edit', update: position => ({ ...position, side: 'b' }) });
  const undone = editorHistory(changed, { type: 'undo' });
  expect(undone.present).toEqual(first.present);
  expect(editorHistory(undone, { type: 'redo' }).present.side).toBe('b');
  expect(editorHistory(undone, { type: 'edit', update: p => ({ ...p, board: p.board.map(row => row.map(() => '')) }) }).future).toEqual([]);
});
it('bounds history and ignores edits that leave the position unchanged', () => {
  let history: EditorHistory = { past: [], present: { board: parseFenBoard(START_FEN), side: 'w' }, future: [] };
  expect(editorHistory(history, { type: 'edit', update: p => ({ ...p }) })).toBe(history);
  for (let i = 0; i < 120; i++) history = editorHistory(history, { type: 'edit', update: p => ({ ...p, side: p.side === 'w' ? 'b' : 'w' }) });
  expect(history.past).toHaveLength(100);
});
