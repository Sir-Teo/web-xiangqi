import { afterEach, expect, it, vi } from 'vitest';
import { START_FEN, parseFenBoard, type BoardState } from '../utils/xiangqi';
import type { ExplorerReply, ExplorerRequest } from './positionExplorer.worker';

async function workerHarness() {
  vi.resetModules();
  const explorer = await import('../utils/positionExplorer');
  const lookup = vi.spyOn(explorer, 'lookupLibraryPosition');
  const messages: ExplorerReply[] = [];
  const scope = {
    onmessage: null as ((event: MessageEvent<ExplorerRequest>) => void) | null,
    postMessage: (reply: ExplorerReply) => messages.push(structuredClone(reply)),
  };
  vi.stubGlobal('self', scope);
  await import('./positionExplorer.worker');
  let nextId = 0;
  const send = (data: ExplorerRequest) => scope.onmessage!({ data } as MessageEvent<ExplorerRequest>);
  const query = (board: BoardState, side: 'w' | 'b' = 'w') => {
    const id = ++nextId;
    send({ type: 'lookup', requestId: id, board, side });
    expect(messages.at(-1)?.requestId).toBe(id);
    return messages.at(-1)!;
  };
  return { send, query, lookup };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('bounds reports and evicts the least recently used position', async () => {
  const { send, query, lookup } = await workerHarness();
  send({ type: 'build', games: [{ id: 'one', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'] }] });
  const root = parseFenBoard(START_FEN);
  const original = query(root);
  const positions = Array.from({ length: 128 }, (_, n) => {
    const board: BoardState = Array.from({ length: 10 }, () => Array(9).fill(''));
    // Distinct placement keys are enough to exercise misses; the index, not
    // a lookup request, is responsible for validating saved game moves.
    for (let bit = 0; bit < 8; bit++) if (n & (1 << bit)) board[0][bit] = 'P';
    return board;
  });
  for (const board of positions.slice(0, 127)) query(board);
  expect(lookup).toHaveBeenCalledTimes(128);
  expect(query(root).report).toEqual(original.report); // Refresh root recency.
  expect(lookup).toHaveBeenCalledTimes(128);
  query(positions[127]);
  expect(query(root).report).toEqual(original.report);
  expect(lookup).toHaveBeenCalledTimes(129);
  query(positions[0]); // Oldest miss was evicted, while the revisited root stays.
  expect(lookup).toHaveBeenCalledTimes(130);
});

it('invalidates cached misses and hits on rebuild and separates side to move', async () => {
  const { send, query, lookup } = await workerHarness();
  const root = parseFenBoard(START_FEN);
  expect(query(root).report.games).toBe(0);
  const game = { id: 'one', savedAt: 1, gameMode: 'PvP' as const, moves: ['h2e2'], label: 'Before' };
  send({ type: 'build', games: [game] });
  const first = query(root);
  expect(first.report.hits[0].label).toBe('Before');
  expect(query(structuredClone(root)).report).toEqual(first.report);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(query(root, 'b').report.games).toBe(0);
  expect(lookup).toHaveBeenCalledTimes(3);
  send({ type: 'build', games: [{ ...game, label: 'After', result: 'black', moves: ['b0c2', 'a0a9'] }] });
  const changed = query(root);
  expect(changed.report.hits[0].label).toBe('After');
  expect(changed.report.moves[0]).toMatchObject({ uci: 'b0c2', blackWins: 1 });
  expect(changed.skipped).toBe(1);
  send({ type: 'build', games: [] });
  expect(query(root)).toMatchObject({ skipped: 0, report: { games: 0, moves: [], hits: [] } });
});
