import { describe, expect, it } from 'vitest';
import { buildCloudPvUrl, parseCloudPvResponse } from './cloudPv';
import { START_FEN, parseFenBoard, validateMoveStr, type BoardState, type Side } from './xiangqi';

const START = `${START_FEN} w - - 0 1`;

describe('buildCloudPvUrl', () => {
    it('asks for the line of the position', () => {
        const url = new URL(buildCloudPvUrl(START));
        expect(url.origin).toBe('https://www.chessdb.cn');
        expect(url.searchParams.get('action')).toBe('querypv');
        expect(url.searchParams.get('board')).toBe(START);
    });
});

describe('parseCloudPvResponse', () => {
    // Recorded from the live service for the start position, the first
    // twelve plies of its 62.
    const live = 'score:1,depth:62,pv:c3c4|b7c7|c0e2|b9a7|b0c2|a9b9|a0b0|h7e7|h2f2|h9g7|h0g2|i9h9';

    it('reads the score, the depth and the bar-separated line', () => {
        const result = parseCloudPvResponse(live);
        expect(result.status).toBe('ok');
        if (result.status !== 'ok') return;
        expect(result.line.score).toBe(1);
        expect(result.line.depth).toBe(62);
        expect(result.line.moves.length).toBe(12);
        expect(result.line.moves.slice(0, 3)).toEqual(['c3c4', 'b7c7', 'c0e2']);
    });

    it('returns a line the rules engine will play', () => {
        const result = parseCloudPvResponse(live);
        if (result.status !== 'ok') throw new Error('expected a line');
        let board: BoardState = parseFenBoard(START_FEN);
        let side: Side = 'w';
        for (const uci of result.line.moves) {
            const checked = validateMoveStr(uci, board, side);
            expect(checked.ok, `${uci}: ${checked.reason}`).toBe(true);
            const next = board.map((row) => [...row]);
            next[checked.mv!.toRank][checked.mv!.toFile] = checked.piece!;
            next[checked.mv!.fromRank][checked.mv!.fromFile] = '';
            board = next;
            side = side === 'w' ? 'b' : 'w';
        }
    });

    it('stops the line at the first token that is not a move', () => {
        const result = parseCloudPvResponse('score:-40,depth:10,pv:c3c4|xx|b7c7');
        expect(result.status === 'ok' && result.line.moves).toEqual(['c3c4']);
        expect(result.status === 'ok' && result.line.score).toBe(-40);
    });

    it('names the replies that are not a line', () => {
        expect(parseCloudPvResponse('unknown').status).toBe('unknown');
        expect(parseCloudPvResponse('nobestmove').status).toBe('unknown');
        expect(parseCloudPvResponse('invalid board').status).toBe('invalid');
        expect(parseCloudPvResponse('checkmate').status).toBe('terminal');
        expect(parseCloudPvResponse('').status).toBe('unreadable');
        expect(parseCloudPvResponse('score:1,depth:5,pv:').status).toBe('unreadable');
    });

    it('refuses a reading that is missing either number, not only both', () => {
        // Found by mutation: `||` joined to `&&` accepts a response carrying a
        // score and no depth, and the depth reaches the panel as NaN. This app
        // has a rule about that -- see `isFiniteNumber` in review.ts.
        expect(parseCloudPvResponse('score:1,pv:c3c4').status).toBe('unreadable');
        expect(parseCloudPvResponse('depth:20,pv:c3c4').status).toBe('unreadable');
        // The control: both present and the same line reads.
        expect(parseCloudPvResponse('score:1,depth:20,pv:c3c4').status).toBe('ok');
        expect(parseCloudPvResponse('<html>').status).toBe('unreadable');
    });
});

it.each(['1.5', '1oops', '1e2', '9007199254740993'])('rejects incomplete or unsafe PV number %s', number => {
    expect(parseCloudPvResponse(`score:${number},depth:20,pv:c3c4`).status).toBe('unreadable');
    expect(parseCloudPvResponse(`score:1,depth:${number},pv:c3c4`).status).toBe('unreadable');
});
