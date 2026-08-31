import { describe, expect, it } from 'vitest';
import { exportPgnFromUci } from './gameExport';
import { extractUciMoveTree, extractAnnotatedMainLine } from './moveImport';

/**
 * A whole game out and back in.
 *
 * The importer stops at the end of the first game, and a PGN game ends at its
 * result token. That is only safe if the exporter never puts a result anywhere
 * but the end -- if it wrapped a long game across lines and a result appeared
 * early, the app would truncate its own export, and round-trip tests on
 * four-move games would never show it.
 *
 * Pikafish against itself at depth 8, 120 plies, which is a full game rather
 * than an opening: long enough to wrap however the exporter wraps, and to run
 * the move numbering into three digits.
 */
const LONG = [
    'b2e2', 'b9c7', 'b0c2', 'a9b9', 'c3c4', 'b7a7', 'h0i2', 'i6i5', 'i0i1', 'g6g5',
    'a0a1', 'h9g7', 'h2h6', 'c9e7', 'i1b1', 'i5i4', 'b1b9', 'c7b9', 'i3i4', 'i9i4',
    'c0a2', 'b9c7', 'h6g6', 'h7h2', 'c2b4', 'a7a3', 'a1h1', 'h2a2', 'b4a2', 'i4i2',
    'h1h7', 'i2i7', 'h7i7', 'g9i7', 'e3e4', 'a6a5', 'a2c3', 'i7g9', 'e4e5', 'e6e5',
    'g6g9', 'f9e8', 'e2e7', 'e9f9', 'g9g5', 'g7f5', 'e7i7', 'f5g3', 'g5a5', 'g3e4',
    'c3d1', 'e4d2', 'd0e1', 'd2b3', 'a5a4', 'c7e6', 'i7i5', 'e8d7', 'e0d0', 'e6f8',
    'i5i2', 'f8g6', 'i2f2', 'c6c5', 'c4c5', 'b3c5', 'd1c3', 'd9e8', 'f2c2', 'c5a4',
    'c3a4', 'g6f4', 'c2f2', 'f4d3', 'f2f1', 'd3b4', 'd0e0', 'e5e4', 'a4b6', 'a3e3',
    'e1f2', 'f9e9', 'f1h1', 'e4f4', 'h1f1', 'f4e4', 'b6c8', 'e9d9', 'f1h1', 'e4d4',
    'h1h2', 'e3e5', 'h2h6', 'e5e6', 'h6h5', 'e8f7', 'c8a7', 'e6e5', 'a7b5', 'd4e4',
    'f0e1', 'b4d3', 'e0f0', 'd3f4', 'h5h2', 'f4h3', 'b5d6', 'e4f4', 'd6c4', 'e5e4',
    'c4d6', 'e4e8', 'g0e2', 'e8e6', 'd6b5', 'e6e7', 'e2c4', 'e7e4', 'c4e2', 'e4e5',
];

describe('a full-length game exported and read back', () => {
    it('is a full-length game rather than an opening', () => {
        expect(LONG).toHaveLength(120);
    });

    it('comes back with every move', () => {
        const pgn = exportPgnFromUci(LONG, { date: '2026.08.31' });
        expect(extractUciMoveTree(pgn).moves).toEqual(LONG);
    });

    it('comes back with every move on the annotated path too', () => {
        const pgn = exportPgnFromUci(LONG, { date: '2026.08.31' });
        expect(extractAnnotatedMainLine(pgn).moves).toEqual(LONG);
    });

    it('is not reported as holding more than one game', () => {
        const pgn = exportPgnFromUci(LONG, { date: '2026.08.31' });
        expect(extractUciMoveTree(pgn).hadMoreGames).toBe(false);
    });

    it('keeps every move for each result marker', () => {
        for (const result of ['red-wins', 'black-wins', 'draw', undefined] as const) {
            const pgn = exportPgnFromUci(LONG, { date: '2026.08.31', result });
            expect(extractUciMoveTree(pgn).moves, `result ${result}`).toEqual(LONG);
        }
    });
});
