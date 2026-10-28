import { expect, it } from 'vitest';
import { studyContent, studyDetailsContent, studyMoveContent } from './studyContent';
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

it('still detects annotation, order and result edits independently of automatic evaluations', () => {
  const base = { moves: [], moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }, { uci: 'b9c7' }] }] };
  const identity = studyMoveContent(base);
  for (const patch of [
    { comment: 'New plan' }, { nags: [1] }, { recordedResult: 'red-wins' as const },
    { children: [{ uci: 'b9c7' }, { uci: 'h9g7' }] },
  ]) expect(studyMoveContent({ ...base, moveTree: [{ ...base.moveTree[0], ...patch }] })).not.toBe(identity);
  expect(studyMoveContent({ ...base, moveTree: [{ ...base.moveTree[0], evalScore: 125, quality: 'good' }] })).toBe(identity);
});
