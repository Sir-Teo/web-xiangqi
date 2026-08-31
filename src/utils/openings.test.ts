import { describe, expect, it } from 'vitest';
import { OPENINGS, getOpeningCandidates, matchOpening } from './openings';
import { START_FEN, parseFenBoard, validateMoveStr } from './xiangqi';

describe('the opening book itself', () => {
    it('only lists lines that can actually be played', () => {
        for (const entry of OPENINGS) {
            const board = parseFenBoard(START_FEN);
            let side: 'w' | 'b' = 'w';
            for (const [index, move] of entry.moves.entries()) {
                const result = validateMoveStr(move, board, side);
                expect(result.ok, `${entry.name} move ${index + 1} (${move}): ${result.reason}`).toBe(true);
                const parsed = result.mv!;
                board[parsed.toRank][parsed.toFile] = board[parsed.fromRank][parsed.fromFile];
                board[parsed.fromRank][parsed.fromFile] = '';
                side = side === 'w' ? 'b' : 'w';
            }
        }
    });

    it('writes every move in the lowercase UCI the matcher expects', () => {
        for (const entry of OPENINGS) {
            for (const move of entry.moves) {
                expect(move).toMatch(/^[a-i][0-9][a-i][0-9]$/);
            }
        }
    });

    it('names each line once, so the board is not choosing between two names', () => {
        // Four lines were in the book twice under different names, and
        // matchOpening returns the first longest match -- so which name the
        // board showed was decided by the order of the array.
        const seen = new Map<string, string>();
        for (const entry of OPENINGS) {
            const line = entry.moves.join(' ');
            expect(seen.get(line), `${line} is also ${seen.get(line)}`).toBeUndefined();
            seen.set(line, entry.name);
        }
    });

    it('does not reuse an English name for two different lines', () => {
        const seen = new Map<string, string>();
        for (const entry of OPENINGS) {
            expect(seen.get(entry.name), `${entry.name} is also ${seen.get(entry.name)}`).toBeUndefined();
            seen.set(entry.name, entry.moves.join(' '));
        }
    });

    it('reads 順炮 as same-direction and 列炮 as opposite-direction', () => {
        // These were the wrong way round on all seven entries: every 順炮 line
        // was labelled Opposite-Direction and every 列炮 line Same-Direction.
        // 順炮 is both central cannons coming from the same flank -- red
        // 炮二平五, black 炮8平5, which is h2e2 h7e7 -- and 列炮 is black
        // answering from the other one, 炮2平5, which is h2e2 b7e7.
        for (const entry of OPENINGS) {
            if (entry.chinese.includes('順炮')) expect(entry.name).toContain('Same-Direction');
            if (entry.chinese.includes('列炮')) expect(entry.name).toContain('Opposite-Direction');
        }
        expect(matchOpening(['h2e2', 'h7e7'])?.chinese).toBe('順炮');
        expect(matchOpening(['h2e2', 'b7e7'])?.chinese).toBe('列炮');
    });

    it('gives every line at least one move and a name', () => {
        for (const entry of OPENINGS) {
            expect(entry.moves.length).toBeGreaterThan(0);
            expect(entry.name.trim()).not.toBe('');
            expect(entry.chinese.trim()).not.toBe('');
        }
    });
});

describe('matching a line', () => {
    it('has no opinion before a move is played', () => {
        expect(matchOpening([])).toBeNull();
    });

    it('names the longest line that matches the moves so far', () => {
        expect(matchOpening(['h2e2'])?.name).toBe('Central Cannon');
        expect(matchOpening(['h2e2', 'h9g7', 'b0c2', 'b9c7'])?.name)
            .toBe('Central Cannon vs Screen Horse Defence');
    });

    it('keeps the name once the game leaves the book', () => {
        const deep = matchOpening(['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0a1', 'a9a8']);
        expect(deep?.name).toBe('Central Cannon vs Screen Horse Defence');
    });

    it('says nothing for a first move the book does not cover', () => {
        expect(matchOpening(['a0a1'])).toBeNull();
    });

    it('reads the same line whatever case it arrives in', () => {
        expect(matchOpening(['H2E2'])?.name).toBe(matchOpening(['h2e2'])?.name);
    });
});

describe('suggesting continuations', () => {
    it('offers only moves that continue a line from here', () => {
        const candidates = getOpeningCandidates([]);
        const firstMoves = new Set(OPENINGS.map(entry => entry.moves[0]));
        expect(candidates.length).toBeGreaterThan(0);
        for (const candidate of candidates) {
            expect(firstMoves.has(candidate.move)).toBe(true);
        }
    });

    it('narrows as the game follows a line', () => {
        const afterCentralCannon = getOpeningCandidates(['h2e2']);
        expect(afterCentralCannon.length).toBeGreaterThan(0);
        for (const candidate of afterCentralCannon) {
            expect(matchOpening(['h2e2', candidate.move])).not.toBeNull();
        }
    });

    it('offers nothing once the game is out of book', () => {
        expect(getOpeningCandidates(['a0a1'])).toEqual([]);
    });

    it('honours the limit, including a nonsensical one', () => {
        expect(getOpeningCandidates([], 2).length).toBeLessThanOrEqual(2);
        expect(getOpeningCandidates([], 0)).toEqual([]);
        expect(getOpeningCandidates([], -5)).toEqual([]);
    });

    it('counts distinct lines rather than book entries', () => {
        // A few lines appear under more than one name. Counting entries let
        // those sort above moves that genuinely branch more widely.
        for (const candidate of getOpeningCandidates([], 50)) {
            const lines = new Set(
                OPENINGS
                    .filter(entry => entry.moves[0] === candidate.move)
                    .map(entry => entry.moves.join(' ')),
            );
            expect(candidate.count).toBe(lines.size);
        }
    });

    it('shows at most three names for a move', () => {
        for (const candidate of getOpeningCandidates([], 50)) {
            expect(candidate.names.length).toBeGreaterThan(0);
            expect(candidate.names.length).toBeLessThanOrEqual(3);
            expect(new Set(candidate.names).size).toBe(candidate.names.length);
        }
    });

    it('reads the history whatever case it arrives in', () => {
        expect(getOpeningCandidates(['H2E2'])).toEqual(getOpeningCandidates(['h2e2']));
    });
});
