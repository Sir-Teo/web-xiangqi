import type { MoveSequenceValidation, SerializableMoveTreeNode } from '../hooks/useXiangqi';
import { describeFenProblem } from './positionSetup';
import { START_POSITION_FEN, parseFenBoard, uciToSquare, validatePieceMove, type BoardState, type Side } from './xiangqi';

function validationRoot(fen: string) {
    if (describeFenProblem(fen)) return null;
    return { board: parseFenBoard(fen), sideToMove: fen.trim().split(/\s+/)[1] as Side };
}

export function validateMoveSequence(moves: string[], startFen?: string): MoveSequenceValidation {
    const root = startFen ? validationRoot(startFen) : validationRoot(START_POSITION_FEN);
    if (!root) {
        return {
            ok: false,
            failedIndex: 0,
            move: '',
            reason: 'Invalid start FEN',
        };
    }

    let currentBoard = root.board;
    let currentSide: Side = root.sideToMove;

    for (const [index, uci] of moves.entries()) {
        const from = uciToSquare(uci.substring(0, 2));
        const to = uciToSquare(uci.substring(2, 4));
        if (!from || !to) {
            return {
                ok: false,
                failedIndex: index,
                move: uci,
                reason: 'Invalid move format',
            };
        }

        const mv = { fromFile: from.file, fromRank: from.rank, toFile: to.file, toRank: to.rank, raw: uci };
        const result = validatePieceMove(currentBoard, mv, currentSide);
        if (!result.ok) {
            return {
                ok: false,
                failedIndex: index,
                move: uci,
                reason: result.reason ?? 'Illegal move',
            };
        }

        const nextBoard = currentBoard.map(row => [...row]) as BoardState;
        nextBoard[to.rank][to.file] = result.piece || '';
        nextBoard[from.rank][from.file] = '';
        currentBoard = nextBoard;
        currentSide = currentSide === 'w' ? 'b' : 'w';
    }

    return { ok: true };
}

export function validateMoveTree(moveTree: SerializableMoveTreeNode[], startFen?: string): MoveSequenceValidation {
    const root = startFen ? validationRoot(startFen) : validationRoot(START_POSITION_FEN);
    if (!root) {
        return {
            ok: false,
            failedIndex: 0,
            move: '',
            reason: 'Invalid start FEN',
        };
    }

    const visitChildren = (
        children: SerializableMoveTreeNode[] | undefined,
        parentBoard: BoardState,
        parentSide: Side,
        plyIndex: number
    ): MoveSequenceValidation => {
        if (!children?.length) return { ok: true };

        for (const child of children) {
            const uci = String(child.uci || '').trim().toLowerCase();
            const from = uciToSquare(uci.substring(0, 2));
            const to = uciToSquare(uci.substring(2, 4));
            if (!from || !to) {
                return {
                    ok: false,
                    failedIndex: plyIndex,
                    move: uci,
                    reason: 'Invalid move format',
                };
            }

            const mv = { fromFile: from.file, fromRank: from.rank, toFile: to.file, toRank: to.rank, raw: uci };
            const result = validatePieceMove(parentBoard, mv, parentSide);
            if (!result.ok) {
                return {
                    ok: false,
                    failedIndex: plyIndex,
                    move: uci,
                    reason: result.reason ?? 'Illegal move',
                };
            }

            const nextBoard = parentBoard.map(row => [...row]) as BoardState;
            nextBoard[to.rank][to.file] = result.piece || '';
            nextBoard[from.rank][from.file] = '';
            const childValidation = visitChildren(child.children, nextBoard, parentSide === 'w' ? 'b' : 'w', plyIndex + 1);
            if (!childValidation.ok) return childValidation;
        }

        return { ok: true };
    };

    return visitChildren(moveTree, root.board, root.sideToMove, 0);
}

