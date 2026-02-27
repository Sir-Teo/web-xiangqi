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
    uciToSquare,
    pieceSide,
    isInCheck
} from '../utils/xiangqi';

export interface MoveRecord {
    uci: string;
    piece: string;
    captured: string;
    evalScore?: number;
    board: BoardState;
    sideToMove: Side;
    inCheck: boolean;
}

export function useXiangqi() {
    const [board, setBoard] = useState<BoardState>(() => parseFenBoard(START_FEN));
    const [sideToMove, setSideToMove] = useState<Side>('w');
    const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([]);
    const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(-1);
    const [selected, setSelected] = useState<{ file: number; rank: number } | null>(null);
    const [validTargets, setValidTargets] = useState<{ file: number; rank: number; capture: boolean }[]>([]);
    const [inCheck, setInCheck] = useState<boolean>(false);

    const currentFen = boardToFen(board, sideToMove, 1 + Math.floor((currentMoveIndex + 1) / 2));

    const resetBoard = useCallback(() => {
        setBoard(parseFenBoard(START_FEN));
        setSideToMove('w');
        setMoveHistory([]);
        setCurrentMoveIndex(-1);
        setSelected(null);
        setValidTargets([]);
        setInCheck(false);
    }, []);

    const jumpToMove = useCallback((index: number) => {
        if (index < -1 || index >= moveHistory.length) return;

        setCurrentMoveIndex(index);
        setSelected(null);
        setValidTargets([]);

        if (index === -1) {
            setBoard(parseFenBoard(START_FEN));
            setSideToMove('w');
            setInCheck(false);
        } else {
            const record = moveHistory[index];
            setBoard(record.board);
            setSideToMove(record.sideToMove);
            setInCheck(record.inCheck);
        }
    }, [moveHistory]);

    const applyUciMove = useCallback((uci: string, evalScore?: number) => {
        const fromSquare = uci.substring(0, 2);
        const toSquare = uci.substring(2, 4);

        const from = uciToSquare(fromSquare);
        const to = uciToSquare(toSquare);

        if (!from || !to) {
            console.error("Invalid UCI move format:", uci);
            return false;
        }

        const mv = {
            fromFile: from.file,
            fromRank: from.rank,
            toFile: to.file,
            toRank: to.rank,
            raw: uci
        };

        const result = validatePieceMove(board, mv, sideToMove);
        if (!result.ok) {
            console.warn("Invalid programmatic move (engine move rejected):", result.reason, uci, "Side:", sideToMove, "Piece:", board[mv.fromRank][mv.fromFile]);
            return false;
        }

        const nextBoard = board.map(row => [...row]);
        nextBoard[to.rank][to.file] = result.piece || '';
        nextBoard[from.rank][from.file] = '';

        const nextSide = sideToMove === 'w' ? 'b' : 'w';
        const nextInCheck = isInCheck(nextBoard, nextSide);

        const historyToKeep = moveHistory.slice(0, currentMoveIndex + 1);
        setMoveHistory([...historyToKeep, {
            uci: mv.raw,
            piece: result.piece!,
            captured: result.captured || '',
            evalScore,
            board: nextBoard,
            sideToMove: nextSide,
            inCheck: nextInCheck
        }]);
        setCurrentMoveIndex(historyToKeep.length);

        setBoard(nextBoard);
        setSideToMove(nextSide);
        setSelected(null);
        setValidTargets([]);
        setInCheck(nextInCheck);

        return true;
    }, [board, sideToMove, moveHistory, currentMoveIndex]);

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

        const nextSide = sideToMove === 'w' ? 'b' : 'w';
        const nextInCheck = isInCheck(nextBoard, nextSide);

        const historyToKeep = moveHistory.slice(0, currentMoveIndex + 1);
        setMoveHistory([...historyToKeep, {
            uci: mv.raw,
            piece: result.piece!,
            captured: result.captured || '',
            board: nextBoard,
            sideToMove: nextSide,
            inCheck: nextInCheck
        }]);
        setCurrentMoveIndex(historyToKeep.length);

        setBoard(nextBoard);
        setSideToMove(nextSide);
        setSelected(null);
        setValidTargets([]);
        setInCheck(nextInCheck);

        return mv.raw; // Return the move string so the caller can send it to the engine
    }, [board, selected, sideToMove, moveHistory, currentMoveIndex]);

    return {
        board,
        sideToMove,
        moveHistory,
        currentMoveIndex,
        selected,
        validTargets,
        currentFen,
        inCheck,
        onSquareClick,
        resetBoard,
        applyUciMove,
        jumpToMove
    };
}
