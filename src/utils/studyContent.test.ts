import { expect, it } from 'vitest';
import { studyContent, studyContentParts, studyDetailsContent, studyMoveContent } from './studyContent';
import type { SavedGame } from './gameLibrary';

const study: SavedGame = { id: 'a', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] };
it('treats a compact line and its tree as the same study while navigating', () => {
  expect(studyContent(study)).toBe(studyContent({ ...study, cursorPly: 0, moves: [], moveTree: [{ uci: 'h2e2', evalScore: 45, children: [{ uci: 'h9g7' }] }] } as SavedGame));
});
it('detects notes, branch edits, main-line pins and metadata', () => {
  for (const patch of [{ rootComment: 'Plan' }, { metadata: { redPlayer: 'Player' } }, { mainLinePinned: true as const }, { moveTree: [{ uci: 'h2e2' }, { uci: 'b2e2' }] }]) {
    expect(studyContent({ ...study, ...patch })).not.toBe(studyContent(study));
  }
});

it('compares details without reading move data', () => {
  const guarded = { ...study,
    get moves(): string[] { throw new Error('Metadata comparison must not read moves'); },
    get moveTree(): SavedGame['moveTree'] { throw new Error('Metadata comparison must not read the tree'); },
  };
  expect(studyDetailsContent(guarded)).toBe(studyDetailsContent(study));
  expect(studyDetailsContent({ ...study, metadata: { redPlayer: 'Alice' } })).not.toBe(studyDetailsContent(study));
});

it('compares move content without reading metadata or review data', () => {
  const guarded = { ...study,
    get metadata(): SavedGame['metadata'] { throw new Error('Move comparison must not read metadata'); },
    get review(): SavedGame['review'] { throw new Error('Move comparison must not read the review'); },
  };
  expect(studyMoveContent(guarded)).toBe(studyMoveContent(study));
  expect(studyMoveContent({ moves: [], moveTree: [{ uci: 'h2e2', evalScore: 42, children: [{ uci: 'h9g7' }] }] }))
    .toBe(studyMoveContent(study));
});

it('compares the metadata that saving retains, independent of edit order and blank fields', () => {
  expect(studyDetailsContent({ ...study, metadata: { redPlayer: '', event: '  ' } })).toBe(studyDetailsContent(study));
  expect(studyDetailsContent({ ...study, metadata: { event: ' Open Cup ', redPlayer: ' Alice ' } }))
    .toBe(studyDetailsContent({ ...study, metadata: { redPlayer: 'Alice', event: 'Open Cup' } }));
  expect(studyDetailsContent({ ...study, metadata: { redPlayer: 'Alice', event: 'Open Cup' } }))
    .not.toBe(studyDetailsContent({ ...study, metadata: { redPlayer: 'Bob', event: 'Open Cup' } }));
});

it('ignores runtime review node IDs while preserving the meaning and source of key moments', () => {
  const reviewed: SavedGame = { ...study, review: {
    summary: { totalMoves: 2, accuracy: 90, bestCount: 0, goodCount: 1, inaccuracyCount: 0, mistakeCount: 1,
      blunderCount: 0, reviewedAt: 1, lineSignature: 'h2e2 h9g7', keyMoments: [{
        nodeId: 'n99', moveIndex: 0, jumpTarget: 0, ply: 1, side: 'red', quality: 'mistake',
        swing: 100, winPercentLoss: 10, evalBefore: 0, evalAfter: -100, playedMove: 'h2e2', note: 'Develop another piece',
      }] }, annotations: [{ moveIndex: 0, evalScore: -100, quality: 'mistake' }],
  } };
  const before = JSON.stringify(reviewed);
  const withMoment = (patch: Partial<NonNullable<SavedGame['review']>['summary']['keyMoments'][number]>): SavedGame => ({
    ...reviewed, review: { ...reviewed.review!, summary: { ...reviewed.review!.summary,
      keyMoments: [{ ...reviewed.review!.summary.keyMoments[0], ...patch }],
    } },
  });
  expect(studyDetailsContent(withMoment({ nodeId: 'n1' }))).toBe(studyDetailsContent(reviewed));
  for (const patch of [{ note: 'New explanation' }, { moveIndex: 1 }, { jumpTarget: 1 }, { evalAfter: -200 }]) {
    expect(studyDetailsContent(withMoment(patch))).not.toBe(studyDetailsContent(reviewed));
  }
  expect(JSON.stringify(reviewed)).toBe(before);
});

it('still detects annotation, order and result edits independently of automatic evaluations', () => {
  const base = { moves: [], moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }, { uci: 'b9c7' }] }] };
  const identity = studyMoveContent(base);
  for (const patch of [
    { comment: 'New plan' }, { nags: [1] }, { recordedResult: 'red-wins' as const },
    { children: [{ uci: 'b9c7' }, { uci: 'h9g7' }] },
  ]) expect(studyMoveContent({ ...base, moveTree: [{ ...base.moveTree[0], ...patch }] })).not.toBe(identity);
  expect(studyMoveContent({ ...base, moveTree: [{ ...base.moveTree[0], evalScore: 125, quality: 'good' }] })).toBe(identity);
});

it.each([['red', 'red-wins'], ['black', 'black-wins'], ['draw', 'draw']] as const)(
  'treats legacy %s as its restored endpoint declaration', (result, recordedResult) => {
    const compact = { ...study, result };
    const restored = { ...study, result: undefined, moves: [],
      moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult }] }] };
    expect(studyContent(compact)).toBe(studyContent(restored));
  },
);

it.each([['red', 'red-wins'], ['black', 'black-wins'], ['draw', 'draw']] as const)(
  'treats a legacy %s at the root as its restored root declaration', (result, rootResult) => {
    const legacy = { ...study, moves: [], metadata: { event: 'Diagram' }, result };
    expect(studyContent(legacy)).toBe(studyContent({ ...legacy, result: undefined, rootResult }));
  },
);

it('restores only the selected occurrence, even when a pinned main line has the same reply', () => {
  const legacy: SavedGame = { ...study, moves: ['b2e2', 'h9g7'], result: 'red', mainLinePinned: true,
    moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }, { uci: 'b2e2', children: [{ uci: 'h9g7' }] }] };
  const restored: SavedGame = { ...legacy, result: undefined, moves: [], moveTree: [legacy.moveTree![0],
    { uci: 'b2e2', children: [{ uci: 'h9g7', recordedResult: 'red-wins' }] }] };
  expect(studyContent(legacy)).toBe(studyContent(restored));
  expect(studyContent({ ...restored, moveTree: [
    { uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'red-wins' }] }, legacy.moveTree![1],
  ] })).not.toBe(studyContent(legacy));
});

it('keeps a saved endpoint result before an unplayed continuation', () => {
  const legacy: SavedGame = { ...study, moves: ['h2e2'], result: 'draw', moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }] };
  expect(studyContent(legacy)).toBe(studyContent({ ...legacy, result: undefined, moves: [],
    moveTree: [{ uci: 'h2e2', recordedResult: 'draw', children: [{ uci: 'h9g7' }] }] }));
});

it('preserves explicit node and root declarations ahead of conflicting legacy outcomes', () => {
  const explicit: SavedGame = { ...study, result: 'red', moveTree: [
    { uci: 'h2e2', children: [{ uci: 'h9g7', recordedResult: 'black-wins' }] },
  ] };
  expect(studyContent(explicit)).toBe(studyContent({ ...explicit, result: undefined }));
  expect(studyContent({ ...study, moves: [], result: 'red', rootResult: 'black-wins' }))
    .toBe(studyContent({ ...study, moves: [], rootResult: 'black-wins' }));
});

it('still detects a real clearing of an outcome in the current study', () => {
  const legacy = { ...study, result: 'red' as const };
  expect(studyContentParts(legacy).moves).not.toBe(studyMoveContent({ moves: [],
    moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }] }));
  expect(studyContentParts({ ...legacy, moves: [], metadata: { event: 'Diagram' } }).details)
    .not.toBe(studyDetailsContent({ ...study, metadata: { event: 'Diagram' } }));
});

it('does not modify a saved tree or backfill an incomplete path', () => {
  const tree = [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }];
  const legacy: SavedGame = { ...study, result: 'red', moveTree: tree };
  const before = JSON.stringify(legacy);
  studyContentParts(legacy);
  expect(JSON.stringify(legacy)).toBe(before);
  expect(studyMoveContent({ ...legacy, moves: ['h2e2', 'a9a8'] }))
    .toBe(studyMoveContent({ ...legacy, moves: [], result: undefined }));
});
