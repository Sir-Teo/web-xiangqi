import { expect, it } from 'vitest';
import { studyContent } from './studyContent';
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
