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
  it('keeps root and move notes attached to their exact branch and ply', () => {
    const source = game({ rootComment: 'Opening plan', moveTree: [
      { uci: 'h2e2', comment: 'Central cannon', children: [
        { uci: 'h9g7', comment: 'Right horse', children: [{ uci: 'h0g2', comment: 'Red develops' }] },
        { uci: 'b9c7', comment: 'Left horse' },
      ] },
      { uci: 'b2e2', comment: 'Other cannon' },
    ] });
    const before = JSON.stringify(source);
    const study = preparePracticeStudy(source).study!;
    expect(study.notes).toEqual([
      [{ ply: 0, comment: 'Opening plan' }, { ply: 1, move: 'h2e2', comment: 'Central cannon' }, { ply: 2, move: 'h9g7', comment: 'Right horse' }, { ply: 3, move: 'h0g2', comment: 'Red develops' }],
      [{ ply: 0, comment: 'Opening plan' }, { ply: 1, move: 'h2e2', comment: 'Central cannon' }, { ply: 2, move: 'b9c7', comment: 'Left horse' }],
      [{ ply: 0, comment: 'Opening plan' }, { ply: 1, move: 'b2e2', comment: 'Other cannon' }],
    ]);
    const alternate = attemptPracticeMove(study, startPracticeLine(study, 0), 'w', 'b2e2');
    expect(study.notes[alternate.session.line].at(-1)?.comment).toBe('Other cannon');
    expect(JSON.stringify(source)).toBe(before);
  });
  it('normalizes notes, omits empty ones and supports a plain line with a root note', () => {
    const plain = preparePracticeStudy(game({ moves: ['h2e2'] })).study!;
    expect(plain.notes).toEqual([[]]);
    expect(preparePracticeStudy(game({ moves: ['h2e2'], rootComment: ' Plan\n{ahead} ' })).study?.notes)
      .toEqual([[{ ply: 0, comment: 'Plan ahead' }]]);
    const annotated = preparePracticeStudy(game({ moveTree: [{ uci: 'h2e2', comment: ' '.repeat(10), children: [{ uci: 'h9g7', comment: 'x'.repeat(600) }] }] })).study!;
    expect(annotated.notes).toEqual([[{ ply: 2, move: 'h9g7', comment: 'x'.repeat(500) }]]);
  });
  it('keeps notes aligned with the retained line when duplicate paths collapse', () => {
    const study = preparePracticeStudy(game({ moveTree: [{ uci: 'h2e2', comment: 'Earlier' }, { uci: 'h2e2', comment: 'Later' }] })).study!;
    expect(study.lines).toEqual([['h2e2']]);
    expect(study.notes).toEqual([[{ ply: 1, move: 'h2e2', comment: 'Later' }]]);
  });
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
    let deep: SavedMoveTreeNode[] = [];
    for (let i = 1024; i >= 0; i--) deep = [{ uci: ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4], children: deep }];
    expect(preparePracticeStudy(game({ moveTree: deep })).error).toMatch(/line has too many moves/);
    const loop: SavedMoveTreeNode = { uci: 'h2e2' }; loop.children = [loop];
    expect(preparePracticeStudy(game({ moveTree: [loop] })).error).toMatch(/circular/);
  });
});
