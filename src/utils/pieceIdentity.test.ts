import { describe, expect, it } from 'vitest';
import { nextPieceIdentityState, type PieceIdentityState } from './pieceIdentity';
import { START_FEN, parseFenBoard, type BoardState } from './xiangqi';

function apply(board: BoardState, uci: string): BoardState {
    const files = 'abcdefghi';
    const fromFile = files.indexOf(uci[0]);
    const fromRank = Number(uci[1]);
    const toFile = files.indexOf(uci[2]);
    const toRank = Number(uci[3]);
    const next = board.map((row) => row.slice());
    next[toRank][toFile] = next[fromRank][fromFile];
    next[fromRank][fromFile] = '';
    return next;
}

function idAt(state: PieceIdentityState, uci2: string) {
    const files = 'abcdefghi';
    return state.ids[Number(uci2[1])][files.indexOf(uci2[0])];
}

function allIds(state: PieceIdentityState) {
    return state.ids.flat().filter(Boolean);
}

function step(board: BoardState, previous: PieceIdentityState | null = null) {
    return nextPieceIdentityState(previous, board);
}

describe('piece identity across a move', () => {
    it('gives every piece a distinct id', () => {
        const state = step(parseFenBoard(START_FEN));
        const ids = allIds(state);
        expect(ids).toHaveLength(32);
        expect(new Set(ids).size).toBe(32);
    });

    it('leaves an empty square without an id', () => {
        const state = step(parseFenBoard(START_FEN));
        expect(idAt(state, 'e1')).toBe('');
        expect(idAt(state, 'e0')).not.toBe('');
    });

    it('carries the id of a quiet move to the destination', () => {
        const start = parseFenBoard(START_FEN);
        const before = step(start);
        const cannonId = idAt(before, 'h2');
        // The fixture must be a piece that is actually there, or "the id
        // travelled" is a claim about two empty strings.
        expect(cannonId).not.toBe('');

        const after = step(apply(start, 'h2e2'), before);
        expect(idAt(after, 'e2')).toBe(cannonId);
        expect(idAt(after, 'h2')).toBe('');
        expect(after.movedTo).toEqual({ file: 4, rank: 2 });
    });

    it('keeps every other piece where it was', () => {
        const start = parseFenBoard(START_FEN);
        const before = step(start);
        const after = step(apply(start, 'h2e2'), before);

        for (let rank = 0; rank < 10; rank += 1) {
            for (let file = 0; file < 9; file += 1) {
                if ((rank === 2 && file === 7) || (rank === 2 && file === 4)) continue;
                expect(after.ids[rank][file]).toBe(before.ids[rank][file]);
            }
        }
    });

    it('carries the capturing piece and drops the captured one', () => {
        const start = parseFenBoard(START_FEN);
        const before = step(start);
        const cannonId = idAt(before, 'h2');
        const soldierId = idAt(before, 'e6');
        expect(soldierId).not.toBe('');

        // h2 cannon captures the soldier on e6 over the e3 screen.
        const after = step(apply(start, 'h2e6'), before);
        expect(idAt(after, 'e6')).toBe(cannonId);
        expect(allIds(after)).not.toContain(soldierId);
        expect(allIds(after)).toHaveLength(31);
    });

    it('carries the id back when the move is stepped back', () => {
        const start = parseFenBoard(START_FEN);
        const before = step(start);
        const cannonId = idAt(before, 'h2');
        const played = step(apply(start, 'h2e2'), before);
        const undone = step(start, played);

        expect(idAt(undone, 'h2')).toBe(cannonId);
        expect(idAt(undone, 'e2')).toBe('');
        expect(undone.movedTo).toEqual({ file: 7, rank: 2 });
    });

    it('carries the capturer back and gives the restored piece a fresh id', () => {
        const start = parseFenBoard(START_FEN);
        const before = step(start);
        const cannonId = idAt(before, 'h2');
        const soldierId = idAt(before, 'e6');
        const captured = step(apply(start, 'h2e6'), before);
        const undone = step(start, captured);

        expect(idAt(undone, 'h2')).toBe(cannonId);
        // The soldier is back on the board and is new to the DOM, so it must
        // not reuse the id that just travelled away from its square.
        expect(idAt(undone, 'e6')).not.toBe('');
        expect(idAt(undone, 'e6')).not.toBe(cannonId);
        expect(idAt(undone, 'e6')).not.toBe(soldierId);
        expect(new Set(allIds(undone)).size).toBe(32);
    });

    it('rebuilds every id when the position jumps by more than one move', () => {
        const start = parseFenBoard(START_FEN);
        const before = step(start);
        const twoMoves = apply(apply(start, 'h2e2'), 'h9g7');

        const after = step(twoMoves, before);
        expect(after.generation).toBe(before.generation + 1);
        expect(after.movedTo).toBeNull();
        // Nothing may look like it slid, so no id may survive the jump.
        const carried = allIds(after).filter((id) => allIds(before).includes(id));
        expect(carried).toEqual([]);
    });

    it('rebuilds when the board is replaced by an unrelated position', () => {
        const before = step(parseFenBoard(START_FEN));
        const endgame = step(parseFenBoard('3ak4/4a4/9/9/9/9/9/4B4/4A4/3AK1B2'), before);
        expect(endgame.generation).toBe(before.generation + 1);
        expect(allIds(endgame)).toHaveLength(8);
    });

    it('keeps the ids when the same position arrives as a different array', () => {
        const start = parseFenBoard(START_FEN);
        const before = step(start);
        const sameAgain = step(parseFenBoard(START_FEN), before);

        expect(sameAgain.generation).toBe(before.generation);
        expect(sameAgain.ids).toEqual(before.ids);
        expect(sameAgain.movedTo).toBeNull();
    });

    it('returns the same state object for the same board, so render may call it', () => {
        const start = parseFenBoard(START_FEN);
        const first = step(start);
        expect(nextPieceIdentityState(first, start)).toBe(first);
    });

    it('stays unique over a long line stepped forwards and back', () => {
        const line = ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'i0h0', 'h7i7', 'c3c4', 'c6c5'];
        const boards: BoardState[] = [parseFenBoard(START_FEN)];
        for (const uci of line) boards.push(apply(boards[boards.length - 1], uci));

        let state = step(boards[0]);
        const seen: string[] = [];
        for (let index = 1; index < boards.length; index += 1) {
            state = step(boards[index], state);
            seen.push(idAt(state, line[index - 1].slice(2)));
            expect(new Set(allIds(state)).size).toBe(allIds(state).length);
        }
        for (let index = boards.length - 2; index >= 0; index -= 1) {
            state = step(boards[index], state);
            expect(new Set(allIds(state)).size).toBe(allIds(state).length);
        }
        // Every step was a real move, so every one of them had something to
        // carry -- an all-empty list would satisfy the uniqueness checks above.
        expect(seen.filter(Boolean)).toHaveLength(line.length);
        expect(state.generation).toBe(0);
    });
});
