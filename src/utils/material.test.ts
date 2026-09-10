import { describe, expect, it } from 'vitest';
import { summarizeMaterial,
    PIECE_NAMES,
    formatCapturedTrayLabel,
    formatMaterialValue,
} from './material';
import { START_FEN, parseFenBoard, type BoardState } from './xiangqi';

const start = () => parseFenBoard(START_FEN);

/** The board after playing `uci` moves from the standard start. */
function play(moves: string[]): BoardState {
    const board = start();
    const file = (c: string) => 'abcdefghi'.indexOf(c);
    for (const uci of moves) {
        const [ff, fr, tf, tr] = [file(uci[0]), Number(uci[1]), file(uci[2]), Number(uci[3])];
        board[tr][tf] = board[fr][ff];
        board[fr][ff] = '';
    }
    return board;
}

describe('a game played from the standard start', () => {
    it('reports nothing captured before anything is', () => {
        const summary = summarizeMaterial(start(), start());
        expect(summary.redCaptured).toEqual([]);
        expect(summary.blackCaptured).toEqual([]);
        expect(summary.redMaterialTenths).toBe(0);
        expect(summary.blackMaterialTenths).toBe(0);
        expect(summary.deltaTenths).toBe(0);
    });

    it('counts a capture to the side that made it', () => {
        // Red's cannon takes the black horse on h9.
        const summary = summarizeMaterial(play(['h2h9']), start());
        expect(summary.redCaptured).toEqual([{ piece: 'n', count: 1 }]);
        expect(summary.blackCaptured).toEqual([]);
        expect(summary.redMaterialTenths).toBe(40);
        expect(summary.deltaTenths).toBe(40);
    });

    it('adds up a haul of several pieces', () => {
        const summary = summarizeMaterial(play(['h2h9', 'b9b2', 'i0i9']), start());
        expect(summary.redCaptured).toEqual([{ piece: 'r', count: 1 }, { piece: 'n', count: 1 }]);
        expect(summary.blackCaptured).toEqual([{ piece: 'C', count: 1 }]);
        expect(summary.redMaterialTenths).toBe(90 + 40);
        expect(summary.blackMaterialTenths).toBe(45);
        expect(summary.deltaTenths).toBe(130 - 45);
    });
});

describe('a position that was set up rather than played to', () => {
    // Two generals, three advisors, one red chariot. Nothing has been captured;
    // the game simply starts here. This is how anyone studies an endgame.
    const ENDGAME = '3ak4/4a4/9/9/9/9/9/9/4A4/3AKR3';

    it('does not invent captures out of the standard opening set', () => {
        // The old reading was `standard set - what is on the board`, which
        // reported "captured by Red: 2 black chariots, 2 horses, 2 cannons,
        // 2 elephants, 5 soldiers" for this position.
        const board = parseFenBoard(ENDGAME);
        const summary = summarizeMaterial(board, board);
        expect(summary.redCaptured).toEqual([]);
        expect(summary.blackCaptured).toEqual([]);
        expect(summary.redMaterialTenths).toBe(0);
        expect(summary.blackMaterialTenths).toBe(0);
    });

    it('still says who is ahead, which the capture reading only got right by algebra', () => {
        // Red has a chariot Black does not. Reading the balance off captures
        // would now call this even, because nothing has been captured -- so the
        // balance is taken from the board instead.
        const board = parseFenBoard(ENDGAME);
        expect(summarizeMaterial(board, board).deltaTenths).toBe(90);
    });

    it('counts captures from where the game began, not from the opening', () => {
        const root = parseFenBoard(ENDGAME);
        // Red's chariot on f0 takes the black advisor on e1... set it up directly.
        const after = parseFenBoard('3ak4/4a4/9/9/9/9/9/9/4R4/3AK4');
        const summary = summarizeMaterial(after, root);
        expect(summary.redCaptured).toEqual([]);
        // Red lost an advisor relative to the start position.
        expect(summary.blackCaptured).toEqual([{ piece: 'A', count: 1 }]);
        expect(summary.blackMaterialTenths).toBe(20);
    });

    it('reports nothing taken when the board holds more than it started with', () => {
        // Only reachable by editing the start position under a loaded game, but
        // a negative haul would render as a tray of minus-one chariots.
        const fewer = parseFenBoard('4k4/9/9/9/9/9/9/9/9/4K4');
        const more = parseFenBoard('4k4/9/9/9/9/9/9/9/9/3RK4');
        const summary = summarizeMaterial(more, fewer);
        expect(summary.blackCaptured).toEqual([]);
        expect(summary.redCaptured).toEqual([]);
        expect(summary.deltaTenths).toBe(90);
    });
});

describe('the balance is symmetric', () => {
    it('reads the same magnitude whichever side is ahead', () => {
        const redUp = parseFenBoard('4k4/9/9/9/9/9/9/9/9/3RK4');
        const blackUp = parseFenBoard('3rk4/9/9/9/9/9/9/9/9/4K4');
        expect(summarizeMaterial(redUp, redUp).deltaTenths).toBe(90);
        expect(summarizeMaterial(blackUp, blackUp).deltaTenths).toBe(-90);
    });

    it('gives the generals no value, so a bare-kings ending is even', () => {
        const bare = parseFenBoard('4k4/9/9/9/9/9/9/9/9/4K4');
        expect(summarizeMaterial(bare, bare).deltaTenths).toBe(0);
    });
});

describe('what the tray says out loud', () => {
    /**
     * The tray draws glyphs. 車 alone tells a screen-reader reader nothing about
     * whose piece it was, and the per-piece tooltip is mouse-only, so this label
     * is the only place the names reach the accessibility tree.
     */
    it('names the side and the piece, not just the piece', () => {
        expect(formatCapturedTrayLabel('Red', [{ piece: 'r', count: 1 }]))
            .toBe('Pieces captured by Red: Black chariot');
        expect(formatCapturedTrayLabel('Black', [{ piece: 'R', count: 1 }]))
            .toBe('Pieces captured by Black: Red chariot');
    });

    it('says none rather than trailing off', () => {
        expect(formatCapturedTrayLabel('Red', [])).toBe('Pieces captured by Red: none');
    });

    it('counts and pluralises, and does not pluralise one', () => {
        expect(formatCapturedTrayLabel('Red', [{ piece: 'p', count: 3 }]))
            .toBe('Pieces captured by Red: 3 Black soldiers');
        expect(formatCapturedTrayLabel('Red', [{ piece: 'p', count: 1 }]))
            .toBe('Pieces captured by Red: Black soldier');
    });

    it('joins a mixed haul with commas', () => {
        expect(formatCapturedTrayLabel('Black', [{ piece: 'R', count: 1 }, { piece: 'P', count: 2 }]))
            .toBe('Pieces captured by Black: Red chariot, 2 Red soldiers');
    });

    /**
     * Every name is regular, so appending "s" is enough -- pinned because the
     * plural above is a bare "s" and a name ending in one would break it.
     */
    it('has a name for every piece, each safe to pluralise that way', () => {
        const codes = ['K', 'A', 'B', 'N', 'R', 'C', 'P', 'k', 'a', 'b', 'n', 'r', 'c', 'p'] as const;
        for (const code of codes) {
            expect(PIECE_NAMES[code]).toMatch(/^(Red|Black) [a-z]+$/);
            expect(PIECE_NAMES[code].endsWith('s')).toBe(false);
        }
        expect(new Set(Object.values(PIECE_NAMES)).size).toBe(codes.length);
    });
});

describe('material as a number on the board', () => {
    it.each([
        [0, '0'],
        [10, '1'],
        [90, '9'],
        [15, '1.5'],
        [-15, '-1.5'],
        [-30, '-3'],
    ])('writes %d tenths as %s', (tenths, expected) => {
        expect(formatMaterialValue(tenths)).toBe(expected);
    });

    it('spends a decimal place only when there is something to say', () => {
        expect(formatMaterialValue(20)).not.toContain('.');
        expect(formatMaterialValue(25)).toContain('.');
    });
});
