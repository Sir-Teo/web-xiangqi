import { describe, expect, it } from 'vitest';
import {
    boardBeforeRecord,
    fileNumberFor,
    formatChineseMove,
    formatLineInStyle,
    formatMoveInStyle,
    formatRecordInStyle,
    formatWxfMove,
    isNotationStyle,
} from './xiangqiNotation';
import { START_FEN, legalMovesFrom, parseFenBoard, pieceSide, squareToUci, type BoardState, type Side } from './xiangqi';

const start = () => parseFenBoard(START_FEN);
const board = (placement: string) => parseFenBoard(placement);

describe('file numbering runs from each player-s own right', () => {
    it('numbers red from the i file and black from the a file', () => {
        expect(fileNumberFor('w', 8)).toBe(1);
        expect(fileNumberFor('w', 0)).toBe(9);
        expect(fileNumberFor('b', 0)).toBe(1);
        expect(fileNumberFor('b', 8)).toBe(9);
    });

    it('agrees with itself on the middle file, which both sides call five', () => {
        expect(fileNumberFor('w', 4)).toBe(5);
        expect(fileNumberFor('b', 4)).toBe(5);
    });
});

describe('the opening every player knows', () => {
    it('writes the central cannon as C2=5 and 炮二平五', () => {
        expect(formatWxfMove(start(), 'h2e2')).toBe('C2=5');
        expect(formatChineseMove(start(), 'h2e2')).toBe('炮二平五');
    });

    it('writes black-s central cannon reply with black-s own numbering', () => {
        expect(formatWxfMove(start(), 'h7e7')).toBe('C8=5');
        expect(formatChineseMove(start(), 'h7e7')).toBe('砲8平5');
    });

    it('writes the screen horse as H8+7 and 馬8進7', () => {
        // The horse moves diagonally, so 7 is the file it lands on.
        expect(formatWxfMove(start(), 'h9g7')).toBe('H8+7');
        expect(formatChineseMove(start(), 'h9g7')).toBe('馬8進7');
    });

    it('writes the red horse the same way in red-s numbering', () => {
        expect(formatWxfMove(start(), 'h0g2')).toBe('H2+3');
        expect(formatChineseMove(start(), 'h0g2')).toBe('傌二進三');
    });
});

describe('the trailing number means a distance or a file, by piece', () => {
    it('counts ranks for a chariot', () => {
        expect(formatWxfMove(board('4k4/9/9/9/9/9/9/9/9/R3K4'), 'a0a4')).toBe('R9+4');
    });

    it('counts ranks for a soldier', () => {
        expect(formatWxfMove(start(), 'a3a4')).toBe('P9+1');
        expect(formatChineseMove(start(), 'a3a4')).toBe('兵九進一');
    });

    it('names a file for an elephant, which cannot move straight', () => {
        expect(formatWxfMove(start(), 'c0e2')).toBe('E7+5');
        expect(formatChineseMove(start(), 'c0e2')).toBe('相七進五');
    });

    it('names a file for an advisor', () => {
        expect(formatWxfMove(start(), 'd0e1')).toBe('A6+5');
        expect(formatChineseMove(start(), 'd0e1')).toBe('仕六進五');
    });

    it('counts ranks for the general, which does move straight', () => {
        expect(formatWxfMove(start(), 'e0e1')).toBe('K5+1');
        expect(formatChineseMove(start(), 'e0e1')).toBe('帥五進一');
    });

    it('names a file when the general steps sideways', () => {
        expect(formatWxfMove(board('4k4/9/9/9/9/9/9/9/9/3RK4'), 'e0f0')).toBe('K5=4');
    });

    it('reads a retreat as a retreat for both sides', () => {
        const state = board('4k4/9/9/9/9/9/9/4R4/9/4K4');
        expect(formatWxfMove(state, 'e2e1')).toBe('R5-1');
        const black = board('4k4/4r4/9/9/9/9/9/9/9/4K4');
        expect(formatWxfMove(black, 'e8e9')).toBe('R5-1');
        expect(formatChineseMove(black, 'e8e9')).toBe('車5退1');
    });
});

describe('two of a kind on one file', () => {
    // FEN is written top to bottom, so row 7 is rank 2: red chariots on a2 and
    // a0. Red advances up the ranks, so a2 is the front one.
    const stackedChariots = board('4k4/9/9/9/9/9/9/R8/9/R3K4');

    it('signs the front one with a plus and drops the file number', () => {
        expect(formatWxfMove(stackedChariots, 'a2a3')).toBe('+R+1');
        expect(formatChineseMove(stackedChariots, 'a2a3')).toBe('前俥進一');
    });

    it('signs the rear one with a minus', () => {
        expect(formatWxfMove(stackedChariots, 'a0a1')).toBe('-R+1');
        expect(formatChineseMove(stackedChariots, 'a0a1')).toBe('後俥進一');
    });

    it('reads front from black-s own direction, not from the board', () => {
        // Black advances down the ranks, so its front chariot is the lower one.
        const black = board('r3k4/9/r8/9/9/9/9/9/9/4K4');
        expect(formatWxfMove(black, 'a7a6')).toBe('+R+1');
        expect(formatWxfMove(black, 'a9a8')).toBe('-R+1');
    });
});

describe('soldiers stacked more than two deep', () => {
    // Three red soldiers on the e file at ranks 4, 5 and 6.
    const three = board('4k4/9/9/4P4/4P4/4P4/9/9/9/4K4');

    it('drops the letter and counts them from the front', () => {
        expect(formatWxfMove(three, 'e6e7')).toBe('15+1');
        expect(formatWxfMove(three, 'e5e6')).toBe('25+1');
        expect(formatWxfMove(three, 'e4e5')).toBe('35+1');
    });

    it('uses front, middle and rear in Chinese', () => {
        expect(formatChineseMove(three, 'e6e7')).toBe('前兵進一');
        expect(formatChineseMove(three, 'e5e6')).toBe('中兵進一');
        expect(formatChineseMove(three, 'e4e5')).toBe('後兵進一');
    });

    it('counts past the three Chinese has words for', () => {
        const four = board('4k4/9/4P4/4P4/4P4/4P4/9/9/9/4K4');
        expect(formatChineseMove(four, 'e7e8')).toBe('一兵進一');
        expect(formatChineseMove(four, 'e4e5')).toBe('四兵進一');
        expect(formatWxfMove(four, 'e4e5')).toBe('45+1');
    });
});

describe('two stacked files at once, which WXF has no answer for', () => {
    // A plus on its own would name two different moves here, so the file stays.
    const twoStacks = board('4k4/9/9/9/9/9/P3P4/9/9/P3P3K');

    it('keeps the file number beside the marker', () => {
        expect(formatWxfMove(twoStacks, 'a3a4')).toBe('+P9+1');
        expect(formatWxfMove(twoStacks, 'e3e4')).toBe('+P5+1');
        expect(formatChineseMove(twoStacks, 'a0a1')).toBe('後九兵進一');
    });
});

function everyLegalMove(state: BoardState, side: Side): string[] {
    const moves: string[] = [];
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            if (pieceSide(state[rank][file]) !== side) continue;
            for (const target of legalMovesFrom(state, file, rank, side)) {
                moves.push(squareToUci(file, rank) + squareToUci(target.file, target.rank));
            }
        }
    }
    return moves;
}

describe('no two legal moves may share a notation', () => {
    // The guarantee that matters: a record is only readable if each move in it
    // names exactly one move. Positions chosen for the cases that collide --
    // stacked chariots, stacked cannons, and soldiers three deep on two files.
    const positions: Array<[string, string, Side]> = [
        ['the opening position, red', START_FEN, 'w'],
        ['the opening position, black', START_FEN, 'b'],
        ['stacked chariots and cannons', '3ak4/4a4/9/9/9/9/R3C4/R3C4/9/3AKA3', 'w'],
        ['soldiers three deep on two files', '3ak4/4a4/9/P3P4/P3P4/P3P4/9/9/9/3AKA3', 'w'],
        ['black doubled on a file', 'r2ak4/r3a4/9/9/9/9/9/9/9/3AKA3', 'b'],
        ['advisors and elephants both able to move', '3ak4/4a4/2b1b4/9/9/9/9/2B1B4/4A4/3AK4', 'w'],
    ];

    for (const [name, fen, side] of positions) {
        it(`formats every legal move distinctly in ${name}`, () => {
            const state = board(fen);
            const moves = everyLegalMove(state, side);
            expect(moves.length).toBeGreaterThan(0);

            for (const style of ['wxf', 'chinese'] as const) {
                const seen = new Map<string, string>();
                for (const uci of moves) {
                    const text = formatMoveInStyle(state, uci, style);
                    const clash = seen.get(text);
                    expect(clash, `${style}: ${uci} and ${clash} both read as ${text}`).toBeUndefined();
                    seen.set(text, uci);
                }
            }
        });
    }
});

describe('falling back rather than lying', () => {
    it('returns null for a move with no piece on the from square', () => {
        expect(formatWxfMove(start(), 'e4e5')).toBeNull();
        expect(formatChineseMove(start(), 'e4e5')).toBeNull();
    });

    it('returns null for something that is not a move at all', () => {
        expect(formatWxfMove(start(), 'zz99')).toBeNull();
        expect(formatChineseMove(start(), '')).toBeNull();
    });

    it('shows the coordinates rather than nothing when it cannot format', () => {
        expect(formatMoveInStyle(start(), 'e4e5', 'wxf')).toBe('E4E5');
        expect(formatMoveInStyle(start(), 'h2e2', 'uci')).toBe('H2E2');
    });

    it('recognises the styles it supports and refuses the rest', () => {
        expect(isNotationStyle('wxf')).toBe(true);
        expect(isNotationStyle('chinese')).toBe(true);
        expect(isNotationStyle('uci')).toBe(true);
        expect(isNotationStyle('algebraic')).toBe(false);
        expect(isNotationStyle(null)).toBe(false);
    });
});

describe('recovering the position a recorded move was played in', () => {
    it('puts the piece and its capture back', () => {
        const after = board('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR');
        const before = boardBeforeRecord({ uci: 'h2e2', piece: 'C', captured: '', board: after });
        expect(before?.[2][7]).toBe('C');
        expect(before?.[2][4]).toBe('');
    });

    it('restores a captured piece to the square it stood on', () => {
        const after = board('4k4/9/9/9/9/9/9/9/9/4K3R');
        const before = boardBeforeRecord({ uci: 'i1i0', piece: 'R', captured: 'r', board: after });
        expect(before?.[0][8]).toBe('r');
        expect(before?.[1][8]).toBe('R');
    });

    it('formats a record without being handed the board before it', () => {
        const after = board('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR');
        const record = { uci: 'h2e2', piece: 'C', captured: '', board: after };
        expect(formatRecordInStyle(record, 'wxf')).toBe('C2=5');
        expect(formatRecordInStyle(record, 'chinese')).toBe('炮二平五');
        expect(formatRecordInStyle(record, 'uci')).toBe('H2E2');
    });
});

describe('a principal variation is replayed, not formatted move by move', () => {
    it('follows the board as the line runs', () => {
        // Formatting move two against the starting position would call the
        // black horse H8+7 again; it has already moved.
        expect(formatLineInStyle(start(), ['h2e2', 'h9g7', 'h0g2'], 'wxf')).toBe('C2=5 H8+7 H2+3');
        expect(formatLineInStyle(start(), ['h2e2', 'h9g7'], 'chinese')).toBe('炮二平五 馬8進7');
    });

    it('re-reads which piece is in front as the line changes it', () => {
        // Two red chariots on the a file, front at a2. After the front one
        // advances the rear one is still the rear one, but the gap has moved.
        const stacked = board('4k4/9/9/9/9/9/9/R8/9/R3K4');
        expect(formatLineInStyle(stacked, ['a2a5', 'e9e8', 'a0a2'], 'wxf')).toBe('+R+3 K5+1 -R+2');
    });

    it('says how many moves it left out', () => {
        const line = ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0i1', 'b7c7', 'b2c2', 'a6a5'];
        expect(formatLineInStyle(start(), line, 'wxf', 3)).toBe('C2=5 H8+7 H2+3 +5');
    });

    it('keeps what it could follow when a line goes off the board', () => {
        expect(formatLineInStyle(start(), ['h2e2', 'e4e5'], 'wxf')).toBe('C2=5 E4E5');
    });

    it('leaves UCI alone', () => {
        expect(formatLineInStyle(start(), ['h2e2', 'h9g7'], 'uci')).toBe('H2E2 H9G7');
    });
});
