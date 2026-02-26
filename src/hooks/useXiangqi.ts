import { useState, useCallback } from 'react';
import type {
    BoardState,
    Side
} from '../utils/xiangqi';
import {
    START_FEN,
    parseFenBoard,
    legalMovesFrom,
    validatePieceMove,
    boardToFen,
    squareToUci,
    pieceSide,
    isInCheck
} from '../utils/xiangqi';

export interface MoveRecord {
    uci: string;
    piece: string;
    captured: string;
}

export function useXiangqi() {
    const [board, setBoard] = useState<BoardState>(() => parseFenBoard(START_FEN));
    const [sideToMove, setSideToMove] = useState<Side>('w');
    const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([]);
    const [selected, setSelected] = useState<{ file: number; rank: number } | null>(null);
    const [validTargets, setValidTargets] = useState<{ file: number; rank: number; capture: boolean }[]>([]);
    const [inCheck, setInCheck] = useState<boolean>(false);

    const currentFen = boardToFen(board, sideToMove, 1 + Math.floor(moveHistory.length / 2));

    const resetBoard = useCallback(() => {
        setBoard(parseFenBoard(START_FEN));
        setSideToMove('w');
        setMoveHistory([]);
        setSelected(null);
        setValidTargets([]);
        setInCheck(false);
    }, []);

    // Returns true if a move was successfully applied
    const onSquareClick = useCallback((file: number, rank: number): string | null => {
        const piece = board[rank][file];

        // If no piece is selected, select it if it belongs to the side to move
        if (!selected) {
            if (piece && pieceSide(piece) === sideToMove) {
                setSelected({ file, rank });
                setValidTargets(legalMovesFrom(board, file, rank, sideToMove));
            }
            return null;
        }

        // Clicking the same piece again deselects
        if (selected.file === file && selected.rank === rank) {
            setSelected(null);
            setValidTargets([]);
            return null;
        }

        // Clicking another of our own pieces selects that one instead
        if (piece && pieceSide(piece) === sideToMove) {
            setSelected({ file, rank });
            setValidTargets(legalMovesFrom(board, file, rank, sideToMove));
            return null;
        }

        // Attempt to move
        const mv = {
            fromFile: selected.file,
            fromRank: selected.rank,
            toFile: file,
            toRank: rank,
            raw: squareToUci(selected.file, selected.rank) + squareToUci(file, rank)
        };

        const result = validatePieceMove(board, mv, sideToMove);
        if (!result.ok) {
            console.warn("Invalid move:", result.reason);
            return null; // Ignore invalid moves
        }

        // Apply move
        const nextBoard = board.map(row => [...row]);
        nextBoard[rank][file] = result.piece || '';
        nextBoard[selected.rank][selected.file] = '';

        setBoard(nextBoard);
        setMoveHistory(prev => [...prev, { uci: mv.raw, piece: result.piece!, captured: result.captured || '' }]);

        const nextSide = sideToMove === 'w' ? 'b' : 'w';
        setSideToMove(nextSide);
        setSelected(null);
        setValidTargets([]);
        setInCheck(isInCheck(nextBoard, nextSide));

        return mv.raw; // Return the move string so the caller can send it to the engine
    }, [board, selected, sideToMove]);

    return {
        board,
        sideToMove,
        moveHistory,
        selected,
        validTargets,
        currentFen,
        inCheck,
        onSquareClick,
        resetBoard
    };
}
