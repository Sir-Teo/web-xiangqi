import { describe, expect, it } from 'vitest';
import { HISTORICAL_GAMES } from './historicalGames';
import { START_FEN, parseFenBoard, validateMoveStr } from './xiangqi';

/**
 * The guard the opening book has had all along, and this file did not.
 *
 * It matters more here than it looks, because nothing downstream catches a bad
 * move: `handleLoadHistoricalGame` calls `loadMoves` without validating, and
 * `loadMoves` stops at the first illegal move *without saying so*. A game with
 * a bad ply therefore loads short and looks complete -- which is exactly what
 * two of these ten were doing when this test was written.
 */
describe('the bundled historical games', () => {
    it('only lists lines that can actually be played', () => {
        for (const game of HISTORICAL_GAMES) {
            const board = parseFenBoard(START_FEN);
            let side: 'w' | 'b' = 'w';
            for (const [index, move] of game.moves.entries()) {
                const result = validateMoveStr(move, board, side);
                expect(
                    result.ok,
                    `${game.id} (${game.redPlayer} vs ${game.blackPlayer}) ply ${index + 1} (${move}): ${result.reason}`
                ).toBe(true);
                const parsed = result.mv!;
                board[parsed.toRank][parsed.toFile] = board[parsed.fromRank][parsed.fromFile];
                board[parsed.fromRank][parsed.fromFile] = '';
                side = side === 'w' ? 'b' : 'w';
            }
        }
    });

    it('writes every move in the lowercase UCI the loader expects', () => {
        for (const game of HISTORICAL_GAMES) {
            for (const move of game.moves) {
                expect(move, `${game.id}: ${move}`).toMatch(/^[a-i][0-9][a-i][0-9]$/);
            }
        }
    });

    it('gives every game an id of its own', () => {
        const ids = HISTORICAL_GAMES.map((game) => game.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('names both players, an event and a date on every entry', () => {
        for (const game of HISTORICAL_GAMES) {
            expect(game.redPlayer.trim(), game.id).not.toBe('');
            expect(game.blackPlayer.trim(), game.id).not.toBe('');
            expect(game.event.trim(), game.id).not.toBe('');
            expect(game.date.trim(), game.id).not.toBe('');
            expect(['red', 'black', 'draw']).toContain(game.result);
        }
    });

    it('says where every entry came from', () => {
        // The absence of this field is what let a fabricated set ship under the
        // names of real grandmasters: the records were asserted, not checkable.
        for (const game of HISTORICAL_GAMES) {
            expect(game.source?.trim(), `${game.id} has no source`).toBeTruthy();
        }
    });

    it('does not repeat a long move sequence across entries', () => {
        // The smell that exposed the old set: seven of ten shared the identical
        // eight-move block `a0a1 a9a8 a1d1 a8d8 i0i1 i9i8 i1h1 i8g8`, which for
        // four of them was half the game. Real games share opening theory, so
        // this only looks at runs long enough that sharing one is not theory.
        const RUN = 8;
        const runs = new Map<string, string>();
        for (const game of HISTORICAL_GAMES) {
            for (let start = 0; start + RUN <= game.moves.length; start += 1) {
                const key = game.moves.slice(start, start + RUN).join(' ');
                const seenIn = runs.get(key);
                expect(
                    seenIn,
                    `${game.id} and ${seenIn} share ${RUN} moves in a row: ${key}`
                ).toBeUndefined();
                runs.set(key, game.id);
            }
        }
    });

    it('stays an opening excerpt rather than growing into a claimed whole game', () => {
        // The file's own framing: these are the first eight to twelve moves a
        // side, and the result beside them belongs to the game they came from.
        // A record long enough to look complete would make Game Review score it
        // as one, which is the defect the framing exists to prevent.
        for (const game of HISTORICAL_GAMES) {
            expect(game.moves.length, `${game.id} is ${game.moves.length} plies`).toBeGreaterThan(0);
            expect(game.moves.length, `${game.id} is ${game.moves.length} plies`).toBeLessThanOrEqual(30);
        }
    });
});
