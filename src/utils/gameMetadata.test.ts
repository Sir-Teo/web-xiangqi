import { describe, expect, it } from 'vitest';
import { extractPgnMetadata, normalizeGameMetadata } from './gameMetadata';
import { exportPgnFromMoveTree, exportPgnFromUci } from './gameExport';
import { normalizeSavedGame } from './gameLibrary';

describe('tournament metadata', () => {
  const metadata = { redPlayer: '王 "A" \\ B', blackPlayer: '李', event: 'Club championship', site: 'Denver', date: '2020.??.??', round: '3.2' };
  it('round-trips escaped names and unknown dates through both exporters and storage', () => {
    const saved = normalizeSavedGame({ id: 'one', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], metadata });
    expect(saved?.metadata).toEqual(metadata);
    for (const pgn of [exportPgnFromUci(['h2e2'], { metadata }), exportPgnFromMoveTree([{ uci: 'h2e2' }], { metadata })]) {
      expect(extractPgnMetadata(pgn!)).toEqual(metadata);
    }
  });
  it('does not read a later game or a comment as this game’s metadata', () => {
    expect(extractPgnMetadata('[White "First"]\n\n1. h2e2 *\n[White "Second"]')).toEqual({ redPlayer: 'First' });
    expect(extractPgnMetadata('1. h2e2 { [Event "Fake"] }')).toBeUndefined();
    expect(extractPgnMetadata('[Red "Red alias"]\n[White "Other"]')).toEqual({ redPlayer: 'Red alias' });
  });
  it('bounds fields and strips control characters without coercing malformed data', () => {
    expect(normalizeGameMetadata({ redPlayer: 12, event: ' A\nB ', site: 'x'.repeat(400), extra: 'ignored' })).toEqual({ event: 'A B', site: 'x'.repeat(256) });
  });
});
