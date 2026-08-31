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
    canonicaliseNotationToken,
    parseMoveInNotation,
    parseMoveLineInNotation,
    parseNotationRecord,
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

describe('reading a move back', () => {
    const startBoard = start();

    it('reads the opening in either notation, and in coordinates', () => {
        expect(parseMoveInNotation(startBoard, 'w', 'C2=5')).toBe('h2e2');
        expect(parseMoveInNotation(startBoard, 'w', '炮二平五')).toBe('h2e2');
        expect(parseMoveInNotation(startBoard, 'w', 'h2e2')).toBe('h2e2');
    });

    it('does not mind which spelling a record uses', () => {
        // Simplified, the red/black glyph split, and Arabic numerals for red --
        // all of these turn up, and all of them mean the same move.
        for (const text of ['炮二平五', '砲二平五', '包二平五', '炮2平5', 'c2=5', 'C2.5', 'C2＝5']) {
            expect(parseMoveInNotation(startBoard, 'w', text), text).toBe('h2e2');
        }
    });

    it('reads black-s reply in black-s own numbering', () => {
        const afterRed = board('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR');
        expect(parseMoveInNotation(afterRed, 'b', 'H8+7')).toBe('h9g7');
        expect(parseMoveInNotation(afterRed, 'b', '马8进7')).toBe('h9g7');
    });

    it('refuses a move that is legal notation but not legal here', () => {
        // A cannon cannot reach file 5 from file 2 with a piece in the way --
        // and nothing that is not a legal move may ever come back.
        expect(parseMoveInNotation(startBoard, 'w', 'K5+1')).toBe('e0e1');
        expect(parseMoveInNotation(startBoard, 'w', 'R9+9')).toBeNull();
        expect(parseMoveInNotation(startBoard, 'w', '炮二平二')).toBeNull();
    });

    it('reads a token against the side to move, not against the board', () => {
        // The opening position is symmetric and the notation is written from
        // each player's own right, so the same token names a move for either
        // side -- a different move. That is the notation working, not a
        // collision: C2=5 is red's cannon to the middle and black's too.
        expect(parseMoveInNotation(startBoard, 'w', 'C2=5')).toBe('h2e2');
        expect(parseMoveInNotation(startBoard, 'b', 'C2=5')).toBe('b7e7');
    });

    it('refuses a token naming a piece this side has nowhere near', () => {
        // Only red has a chariot here, and only on file 9. The black general
        // stands off the e file so the two are not facing, which would make
        // every red move illegal.
        const lopsided = board('3k5/9/9/9/9/9/9/9/9/R3K4');
        expect(parseMoveInNotation(lopsided, 'w', 'R9+1')).toBe('a0a1');
        expect(parseMoveInNotation(lopsided, 'b', 'R9+1')).toBeNull();
        expect(parseMoveInNotation(lopsided, 'w', 'H5+3')).toBeNull();
    });

    it('refuses coordinates that name no legal move', () => {
        expect(parseMoveInNotation(startBoard, 'w', 'e4e5')).toBeNull();
        expect(parseMoveInNotation(startBoard, 'w', 'zzzz')).toBeNull();
    });

    it('skips what cannot be a move at all', () => {
        for (const text of ['1.', '2...', '1-0', '', '   ', '(comment)', '红先胜']) {
            expect(canonicaliseNotationToken(text), text).toBeNull();
        }
    });
});

describe('every legal move survives a round trip', () => {
    // The guarantee the generate-and-match design exists to give: whatever the
    // formatter writes, the parser reads back as the same move, in both
    // notations, in every position.
    const positions: Array<[string, string, Side]> = [
        ['the opening position, red', START_FEN, 'w'],
        ['the opening position, black', START_FEN, 'b'],
        ['stacked chariots and cannons', '3ak4/4a4/9/9/9/9/R3C4/R3C4/9/3AKA3', 'w'],
        ['soldiers three deep on two files', '3ak4/4a4/9/P3P4/P3P4/P3P4/9/9/9/3AKA3', 'w'],
        ['advisors and elephants both able to move', '3ak4/4a4/2b1b4/9/9/9/9/2B1B4/4A4/3AK4', 'w'],
    ];

    for (const [name, fen, side] of positions) {
        it(`round trips every legal move in ${name}`, () => {
            const state = board(fen);
            const moves = everyLegalMove(state, side);
            expect(moves.length).toBeGreaterThan(0);
            for (const uci of moves) {
                for (const style of ['wxf', 'chinese'] as const) {
                    const text = formatMoveInStyle(state, uci, style);
                    expect(parseMoveInNotation(state, side, text), `${style} ${text}`).toBe(uci);
                }
            }
        });
    }
});

describe('reading a whole record', () => {
    it('replays a Chinese game record, move numbers and all', () => {
        const record = '1. 炮二平五 马8进7 2. 马二进三 车9平8 3. 车一平二';
        const parsed = parseMoveLineInNotation(start(), 'w', record);
        // Black numbers its files from its own right, so 车9平8 is the chariot
        // on i9 sliding onto the square the horse just left.
        expect(parsed.moves).toEqual(['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0']);
        expect(parsed.rejected).toEqual([]);
    });

    it('replays the same game written in WXF', () => {
        const record = '1. C2=5 H8+7 2. H2+3 R9=8 3. R1=2';
        const parsed = parseMoveLineInNotation(start(), 'w', record);
        expect(parsed.moves).toEqual(['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0']);
    });

    it('parses each move against the position it was played in', () => {
        // 车9平8 is only readable once the black chariot on a9 is the one meant;
        // formatting the whole line against the start position would not do.
        const parsed = parseMoveLineInNotation(start(), 'w', '炮二平五 马8进7 马二进三 车9平8');
        expect(parsed.moves).toHaveLength(4);
        expect(parsed.moves[3]).toBe('i9h9');
    });

    it('collects a move-shaped token that names no move', () => {
        // 马5进3 is shaped like a move and there is no horse on file 5.
        const parsed = parseMoveLineInNotation(start(), 'w', '1. 炮二平五 马5进3');
        expect(parsed.moves).toEqual(['h2e2']);
        expect(parsed.rejected).toEqual(['马5进3']);
    });

    it('stops at the cap rather than walking a hostile paste', () => {
        const parsed = parseMoveLineInNotation(start(), 'w', '炮二平五 马8进7 马二进三', 2);
        expect(parsed.moves).toHaveLength(2);
    });

    it('returns nothing for text that holds no moves', () => {
        const parsed = parseMoveLineInNotation(start(), 'w', 'the quick brown fox 1-0');
        expect(parsed.moves).toEqual([]);
    });
});

describe('a record as it actually arrives', () => {
    it('reads one that starts with the whitespace a stripped header leaves behind', () => {
        // `[Event "..."]` is replaced by a space, so the text handed to the
        // parser begins with separators. Stopping at the first empty token
        // meant every real record parsed as nothing.
        const parsed = parseMoveLineInNotation(start(), 'w', ' \n1. 炮二平五 马8进7\n2. 马二进三');
        expect(parsed.moves).toEqual(['h2e2', 'h9g7', 'h0g2']);
    });

    it('reads a record through the FEN-aware entry point', () => {
        expect(parseNotationRecord(undefined, ' \n1. C2=5 H8+7').moves).toEqual(['h2e2', 'h9g7']);
    });

    it('starts from the FEN it is given, and from black when the FEN says so', () => {
        const parsed = parseNotationRecord('3k5/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'R9+1');
        expect(parsed.moves).toEqual(['a0a1']);
        // Black counts files from the a file, so its general on d9 is on file 4.
        const black = parseNotationRecord('3k5/9/9/9/9/9/9/9/9/R3K4 b - - 0 1', 'K4+1');
        expect(black.moves).toEqual(['d9d8']);
    });

    it('falls back to the opening position rather than losing the moves', () => {
        expect(parseNotationRecord('not a fen at all', '1. C2=5').moves).toEqual(['h2e2']);
    });
});

describe('a record the reader cannot follow', () => {
    /**
     * Reading one token costs a full legal-move generation plus writing every
     * legal move in both notations. `maxMoves` bounds the moves that *matched*,
     * so it does not bound that work at all: a paste where every token looks
     * like a move and none of them is one pays the price per token and matches
     * nothing. Forty thousand of them -- which fits inside the import box's
     * 200,000-character limit -- took four and a half seconds on the main
     * thread before this bound existed.
     *
     * Stopping is not a loss. After the first token that reads as a move and
     * names none, the record and the board have parted company, and every
     * later token is being matched against a position the record never
     * reached.
     */
    it('stops at the first move it cannot place', () => {
        const parsed = parseNotationRecord(undefined, 'C9=9 '.repeat(5_000));
        expect(parsed.moves).toEqual([]);
        expect(parsed.rejected).toEqual(['C9=9']);
    });

    it('stops on a coordinate that names no legal move too', () => {
        // Same reasoning: the record wanted a move this reader cannot play,
        // so the board and the record have parted company either way.
        const parsed = parseNotationRecord(undefined, 'h2e2 '.repeat(5_000));
        expect(parsed.moves).toEqual(['h2e2']);
        expect(parsed.rejected).toEqual(['h2e2']);
    });

    it('imports a true prefix rather than a game nobody played', () => {
        // R5=9 names no move; H2+3 *is* legal in the position the reader is
        // still sitting on, so reading on used to import it as move three of a
        // game whose move three was something else entirely.
        const parsed = parseNotationRecord(undefined, 'C2=5 H8+7 R5=9 H2+3');
        expect(parsed.moves).toEqual(['h2e2', 'h9g7']);
        expect(parsed.rejected).toEqual(['R5=9']);
    });

    it('still reads a long record whose every move is good', () => {
        // The bound must not be reachable by a record that parses, or a real
        // game would stop being read partway through. Both chariots shuffling
        // is 80 plies of entirely legal moves -- comfortably past 64 -- and it
        // is built by the formatter so the fixture cannot drift from it.
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        const long = Array.from({ length: 20 }, () => cycle).flat();
        const text = formatLineInStyle(parseFenBoard(START_FEN), long, 'wxf', long.length);
        const parsed = parseNotationRecord(undefined, text);
        expect(parsed.rejected).toEqual([]);
        expect(parsed.moves).toEqual(long);
    });

    it('does not stop on a move number or a result', () => {
        // These are decoration rather than moves, so a hundred of them in a
        // row must not stop a record that is otherwise readable.
        const noise = Array.from({ length: 200 }, (_, i) => `${i + 1}.`).join(' ');
        const parsed = parseNotationRecord(undefined, `${noise} C2=5 1-0`);
        expect(parsed.moves).toEqual(['h2e2']);
    });
});
