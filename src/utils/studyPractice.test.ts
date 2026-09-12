import { describe, expect, it } from 'vitest';
import { MAX_SAVED_TREE_NODES, type SavedGame, type SavedMoveTreeNode } from './gameLibrary';
import { START_POSITION_FEN, boardToFen } from './xiangqi';
import { attemptPracticeMove, nextPracticeLine, playPracticeReply, practiceComplete, practiceLineIndices, preparePracticeStudy, startPracticeLine } from './studyPractice';

const game = (extra: Partial<SavedGame> = {}): SavedGame => ({ id: 'practice', savedAt: 1, gameMode: 'PvP', moves: [], ...extra });
const branched = game({ moveTree: [
  { uci: 'h2e2', children: [{ uci: 'h9g7', children: [{ uci: 'h0g2' }] }, { uci: 'b9c7', children: [{ uci: 'b0c2' }] }] },
  { uci: 'b2e2', children: [{ uci: 'h9g7' }] },
] });

describe('saved study practice', () => {
  it('includes all variations without changing the saved cursor, annotations or tree', () => {
    const original = JSON.stringify(branched);
    const prepared = preparePracticeStudy(branched);
    expect(prepared.error).toBeNull();
    expect(prepared.study?.lines).toEqual([['h2e2', 'h9g7', 'h0g2'], ['h2e2', 'b9c7', 'b0c2'], ['b2e2', 'h9g7']]);
    expect(JSON.stringify(branched)).toBe(original);
  });
  it('uses a saved straight line and preserves a custom Black starting side', () => {
    const study = preparePracticeStudy(game({ startFen: START_POSITION_FEN.replace(' w ', ' b '), moves: ['h9g7'] })).study!;
    expect(study.side).toBe('b');
    expect(practiceLineIndices(study, 'b')).toEqual([0]);
    expect(practiceLineIndices(study, 'w')).toEqual([]);
    const result = attemptPracticeMove(study, startPracticeLine(study, 0), 'b', 'h9g7');
    expect(result.matched).toBe(true);
    expect(practiceComplete(study, result.session)).toBe(true);
  });
  it('accepts another stored continuation and follows that branch', () => {
    const study = preparePracticeStudy(branched).study!;
    const first = attemptPracticeMove(study, startPracticeLine(study, 0), 'w', 'b2e2');
    expect(first.matched).toBe(true);
    expect(first.session.line).toBe(2);
    expect(first.session.answered).toBe(1);
    expect(first.session.recalled).toBe(1);
    const last = playPracticeReply(study, first.session, 'w');
    expect(last.moves).toEqual(['b2e2', 'h9g7']);
    expect(last.completed).toEqual([2]);
    expect(nextPracticeLine(study, last, 'w')).toBe(0);
  });
  it('keeps legal off-study and illegal attempts on the same board', () => {
    const study = preparePracticeStudy(branched).study!;
    const session = startPracticeLine(study, 0);
    const outside = attemptPracticeMove(study, session, 'w', 'a3a4');
    expect(outside.message).toMatch(/legal, but outside/);
    expect(outside.session.board).toBe(session.board);
    expect(outside.session.moves).toEqual([]);
    const retry = attemptPracticeMove(study, outside.session, 'w', 'h2e2');
    expect(retry.session.answered).toBe(1);
    expect(retry.session.recalled).toBe(0);
    const illegal = attemptPracticeMove(study, session, 'w', 'h0h2');
    expect(illegal.matched).toBe(false);
    expect(illegal.session).toBe(session);
  });
  it('separates assisted recall from an engine judgment and avoids duplicate completion credit', () => {
    const study = preparePracticeStudy(game({ moves: ['h2e2'] })).study!;
    const session = { ...startPracticeLine(study, 0), assisted: true };
    const done = attemptPracticeMove(study, session, 'w', 'h2e2').session;
    expect(done).toMatchObject({ answered: 1, recalled: 0, completed: [0] });
    const again = startPracticeLine(study, 0, done);
    expect(attemptPracticeMove(study, again, 'w', 'h2e2').session).toMatchObject({ answered: 2, recalled: 1, completed: [0] });
  });
  it('waits for explicit opponent replies and does not accept moves after completion', () => {
    const study = preparePracticeStudy(game({ moves: ['h2e2', 'h9g7'] })).study!;
    const start = startPracticeLine(study, 0);
    expect(attemptPracticeMove(study, start, 'b', 'h9g7').session).toBe(start);
    const reply = playPracticeReply(study, start, 'b');
    expect(boardToFen(start.board, start.side)).toBe(START_POSITION_FEN);
    const done = attemptPracticeMove(study, reply, 'b', 'h9g7').session;
    expect(attemptPracticeMove(study, done, 'b', 'b9c7').session).toBe(done);
    expect(playPracticeReply(study, done, 'b')).toBe(done);
  });
  it('does not silently omit an illegal side branch', () => {
    expect(preparePracticeStudy(game({ moveTree: [{ uci: 'h2e2' }, { uci: 'h0h2' }] })).error).toMatch(/illegal/);
    expect(preparePracticeStudy(game()).error).toMatch(/with moves/);
    expect(preparePracticeStudy(game({ startFen: 'bad fen', moves: ['h2e2'] })).study).toBeNull();
  });
  it('bounds deep records before recursion or large path allocation', () => {
    expect(preparePracticeStudy(game({ moves: Array(MAX_SAVED_TREE_NODES + 1).fill('a0a1') })).study).toBeNull();
    const loop: SavedMoveTreeNode = { uci: 'h2e2' }; loop.children = [loop];
    expect(preparePracticeStudy(game({ moveTree: [loop] })).error).toMatch(/circular/);
  });
});
