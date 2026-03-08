import { useMemo, useRef, useState, useCallback } from 'react';
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
    isInCheck,
    hasAnyLegalMove,
} from '../utils/xiangqi';

export type GameResult = 'red-wins' | 'black-wins' | 'draw' | null;

export interface MoveRecord {
    uci: string;
    piece: string;
    captured: string;
    evalScore?: number;
    bestMove?: string; // engine's best from this position (set during review)
    board: BoardState;
    sideToMove: Side;
    inCheck: boolean;
    ply: number;
}

export interface MoveTreeNode {
    id: string;
    parentId: string | null;
    childrenIds: string[];
    record?: MoveRecord;
}

const ROOT_NODE_ID = 'root';

function createRootTree(): Record<string, MoveTreeNode> {
    return {
        [ROOT_NODE_ID]: {
            id: ROOT_NODE_ID,
            parentId: null,
            childrenIds: [],
        },
    };
}

function findPathToNode(treeNodes: Record<string, MoveTreeNode>, nodeId: string): string[] {
    if (!treeNodes[nodeId]) return [];
    const path: string[] = [];
    let cursor: string | null = nodeId;
    while (cursor && cursor !== ROOT_NODE_ID) {
        path.unshift(cursor);
        cursor = treeNodes[cursor]?.parentId ?? null;
    }
    return path;
}

function preferredContinuation(treeNodes: Record<string, MoveTreeNode>, startNodeId: string): string[] {
    const continuation: string[] = [];
    let cursor = startNodeId;
    while (treeNodes[cursor]?.childrenIds.length) {
        const children = treeNodes[cursor].childrenIds;
        // Follow the most recently explored branch.
        const preferredChild = children[children.length - 1];
        continuation.push(preferredChild);
        cursor = preferredChild;
    }
    return continuation;
}

function getPositionFromNode(treeNodes: Record<string, MoveTreeNode>, nodeId: string) {
    if (nodeId === ROOT_NODE_ID) {
        return {
            board: parseFenBoard(START_FEN),
            sideToMove: 'w' as Side,
            inCheck: false,
        };
    }
    const node = treeNodes[nodeId];
    if (!node?.record) {
        return {
            board: parseFenBoard(START_FEN),
            sideToMove: 'w' as Side,
            inCheck: false,
        };
    }
    return {
        board: node.record.board,
        sideToMove: node.record.sideToMove,
        inCheck: node.record.inCheck,
    };
}

export function useXiangqi() {
    const [treeNodes, setTreeNodes] = useState<Record<string, MoveTreeNode>>(() => createRootTree());
    const [activeLineNodeIds, setActiveLineNodeIds] = useState<string[]>([]);
    const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(-1);

    const [board, setBoard] = useState<BoardState>(() => parseFenBoard(START_FEN));
    const [sideToMove, setSideToMove] = useState<Side>('w');
    const [selected, setSelected] = useState<{ file: number; rank: number } | null>(null);
    const [validTargets, setValidTargets] = useState<{ file: number; rank: number; capture: boolean }[]>([]);
    const [inCheck, setInCheck] = useState<boolean>(false);
    const [gameResult, setGameResult] = useState<GameResult>(null);

    // Position history for repetition detection (FEN → count)
    const positionHistoryRef = useRef<Map<string, number>>(new Map());

    const nodeCounterRef = useRef(1);

    const currentNodeId = currentMoveIndex >= 0 ? activeLineNodeIds[currentMoveIndex] ?? ROOT_NODE_ID : ROOT_NODE_ID;
    const moveHistory = useMemo(
        () => activeLineNodeIds.map((nodeId) => treeNodes[nodeId]?.record).filter((record): record is MoveRecord => Boolean(record)),
        [activeLineNodeIds, treeNodes]
    );
    const currentFen = boardToFen(board, sideToMove, 1 + Math.floor((currentMoveIndex + 1) / 2));

    const syncPositionForNode = useCallback((nextTree: Record<string, MoveTreeNode>, nodeId: string) => {
        const position = getPositionFromNode(nextTree, nodeId);
        setBoard(position.board);
        setSideToMove(position.sideToMove);
        setInCheck(position.inCheck);
        setSelected(null);
        setValidTargets([]);
    }, []);

    const resetBoard = useCallback(() => {
        const rootTree = createRootTree();
        setTreeNodes(rootTree);
        setActiveLineNodeIds([]);
        setCurrentMoveIndex(-1);
        setBoard(parseFenBoard(START_FEN));
        setSideToMove('w');
        setSelected(null);
        setValidTargets([]);
        setInCheck(false);
        setGameResult(null);
        positionHistoryRef.current = new Map();
        nodeCounterRef.current = 1;
    }, []);

    const loadFen = useCallback((fen: string): boolean => {
        try {
            const parts = fen.trim().split(/\s+/);
            const board = parseFenBoard(parts[0]);
            // Basic validation: both kings must be present
            const flat = board.flat();
            if (!flat.includes('K') || !flat.includes('k')) return false;
            const sideChar = parts[1];
            const side: Side = sideChar === 'b' ? 'b' : 'w';
            const rootTree = createRootTree();
            setTreeNodes(rootTree);
            setActiveLineNodeIds([]);
            setCurrentMoveIndex(-1);
            setBoard(board);
            setSideToMove(side);
            setSelected(null);
            setValidTargets([]);
            setInCheck(isInCheck(board, side));
            setGameResult(null);
            positionHistoryRef.current = new Map();
            nodeCounterRef.current = 1;
            return true;
        } catch {
            return false;
        }
    }, []);

    const loadMoves = useCallback((moves: string[]) => {
        let currentBoard = parseFenBoard(START_FEN);
        let currentSide: Side = 'w';
        const tree: Record<string, MoveTreeNode> = createRootTree();
        let parentNodeId = ROOT_NODE_ID;
        const activeLine: string[] = [];
        let counter = 1;
        let lastIndex = -1;

        for (const uci of moves) {
            const from = uciToSquare(uci.substring(0, 2));
            const to = uciToSquare(uci.substring(2, 4));
            if (!from || !to) break;
            const mv = { fromFile: from.file, fromRank: from.rank, toFile: to.file, toRank: to.rank, raw: uci };
            const result = validatePieceMove(currentBoard, mv, currentSide);
            if (!result.ok) break;

            const nextBoard = currentBoard.map(row => [...row]) as BoardState;
            nextBoard[to.rank][to.file] = result.piece || '';
            nextBoard[from.rank][from.file] = '';
            const nextSide: Side = currentSide === 'w' ? 'b' : 'w';
            const nextInCheck = isInCheck(nextBoard, nextSide);

            const nodeId = `n${counter++}`;
            tree[parentNodeId].childrenIds.push(nodeId);
            tree[nodeId] = {
                id: nodeId,
                parentId: parentNodeId,
                childrenIds: [],
                record: {
                    uci,
                    piece: result.piece!,
                    captured: result.captured || '',
                    board: nextBoard,
                    sideToMove: nextSide,
                    inCheck: nextInCheck,
                    ply: lastIndex + 2,
                },
            };

            activeLine.push(nodeId);
            parentNodeId = nodeId;
            lastIndex++;
            currentBoard = nextBoard;
            currentSide = nextSide;
        }

        nodeCounterRef.current = counter;
        setTreeNodes(tree);
        setActiveLineNodeIds(activeLine);
        setCurrentMoveIndex(lastIndex);
        setBoard(currentBoard);
        setSideToMove(currentSide);
        setInCheck(isInCheck(currentBoard, currentSide));
        setSelected(null);
        setValidTargets([]);
    }, []); // no deps — uses only local vars and stable refs

    const jumpToNode = useCallback((nodeId: string) => {
        const targetId = nodeId && treeNodes[nodeId] ? nodeId : ROOT_NODE_ID;
        const path = findPathToNode(treeNodes, targetId);
        const continuation = preferredContinuation(treeNodes, targetId);
        const nextActiveLine = [...path, ...continuation];
        const nextIndex = path.length - 1;

        setActiveLineNodeIds(nextActiveLine);
        setCurrentMoveIndex(nextIndex);
        syncPositionForNode(treeNodes, targetId);
    }, [treeNodes, syncPositionForNode]);

    const jumpToMove = useCallback((index: number) => {
        if (index < -1 || index >= activeLineNodeIds.length) return;
        const nodeId = index === -1 ? ROOT_NODE_ID : activeLineNodeIds[index];
        setCurrentMoveIndex(index);
        syncPositionForNode(treeNodes, nodeId);
    }, [activeLineNodeIds, treeNodes, syncPositionForNode]);

    const applyUciMove = useCallback((uci: string, evalScore?: number) => {
        const fromSquare = uci.substring(0, 2);
        const toSquare = uci.substring(2, 4);

        const from = uciToSquare(fromSquare);
        const to = uciToSquare(toSquare);

        if (!from || !to) {
            console.error('Invalid UCI move format:', uci);
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
            console.warn('Invalid programmatic move (engine move rejected):', result.reason, uci, 'Side:', sideToMove, 'Piece:', board[mv.fromRank][mv.fromFile]);
            return false;
        }

        const nextBoard = board.map((row) => [...row]);
        nextBoard[to.rank][to.file] = result.piece || '';
        nextBoard[from.rank][from.file] = '';

        const nextSide = sideToMove === 'w' ? 'b' : 'w';
        const nextInCheck = isInCheck(nextBoard, nextSide);

        // Game over: in Xiangqi, no legal moves = loss for the player to move
        if (!hasAnyLegalMove(nextBoard, nextSide)) {
            setGameResult(nextSide === 'w' ? 'black-wins' : 'red-wins');
        } else {
            // Threefold repetition detection (position key = board + side to move)
            const posKey = boardToFen(nextBoard, nextSide);
            const posCount = (positionHistoryRef.current.get(posKey) ?? 0) + 1;
            positionHistoryRef.current.set(posKey, posCount);
            if (posCount >= 3) {
                setGameResult('draw');
            }
        }

        const parentNodeId = currentNodeId;
        const parentNode = treeNodes[parentNodeId];
        const existingChildId = parentNode?.childrenIds.find((childId) => treeNodes[childId]?.record?.uci === mv.raw);

        const activePrefix = activeLineNodeIds.slice(0, currentMoveIndex + 1);

        if (existingChildId) {
            const existingChild = treeNodes[existingChildId];
            const updatedRecord: MoveRecord | undefined = existingChild.record ? {
                ...existingChild.record,
                evalScore: evalScore ?? existingChild.record.evalScore,
            } : undefined;

            const nextTree: Record<string, MoveTreeNode> = updatedRecord ? {
                ...treeNodes,
                [existingChildId]: {
                    ...existingChild,
                    record: updatedRecord,
                }
            } : treeNodes;

            setTreeNodes(nextTree);

            const keptFuture = activeLineNodeIds[currentMoveIndex + 1] === existingChildId
                ? activeLineNodeIds.slice(currentMoveIndex + 1)
                : [existingChildId, ...preferredContinuation(nextTree, existingChildId)];

            const nextActiveLine = [...activePrefix, ...keptFuture];
            const nextIndex = currentMoveIndex + 1;

            setActiveLineNodeIds(nextActiveLine);
            setCurrentMoveIndex(nextIndex);
            syncPositionForNode(nextTree, existingChildId);
            return true;
        }

        const newNodeId = `n${nodeCounterRef.current++}`;
        const newRecord: MoveRecord = {
            uci: mv.raw,
            piece: result.piece!,
            captured: result.captured || '',
            evalScore,
            board: nextBoard,
            sideToMove: nextSide,
            inCheck: nextInCheck,
            ply: currentMoveIndex + 2,
        };

        const nextTree: Record<string, MoveTreeNode> = {
            ...treeNodes,
            [parentNodeId]: {
                ...parentNode,
                childrenIds: [...parentNode.childrenIds, newNodeId],
            },
            [newNodeId]: {
                id: newNodeId,
                parentId: parentNodeId,
                childrenIds: [],
                record: newRecord,
            },
        };

        setTreeNodes(nextTree);
        setActiveLineNodeIds([...activePrefix, newNodeId]);
        setCurrentMoveIndex(activePrefix.length);
        syncPositionForNode(nextTree, newNodeId);
        return true;
    }, [board, sideToMove, currentNodeId, treeNodes, activeLineNodeIds, currentMoveIndex, syncPositionForNode]);

    const setCurrentNodeEval = useCallback((evalScore: number) => {
        if (!Number.isFinite(evalScore) || currentNodeId === ROOT_NODE_ID) return;
        setTreeNodes((prevTree) => {
            const node = prevTree[currentNodeId];
            if (!node?.record) return prevTree;
            if (node.record.evalScore === evalScore) return prevTree;
            return {
                ...prevTree,
                [currentNodeId]: {
                    ...node,
                    record: { ...node.record, evalScore },
                },
            };
        });
    }, [currentNodeId]);

    const getNodeFen = useCallback((nodeId: string): string => {
        const pos = getPositionFromNode(treeNodes, nodeId);
        const node = treeNodes[nodeId];
        const ply = node?.record?.ply ?? 1;
        return boardToFen(pos.board, pos.sideToMove, 1 + Math.floor(ply / 2));
    }, [treeNodes]);

    const setNodeEval = useCallback((nodeId: string, evalScore: number) => {
        if (!Number.isFinite(evalScore) || nodeId === ROOT_NODE_ID) return;
        setTreeNodes((prevTree) => {
            const node = prevTree[nodeId];
            if (!node?.record) return prevTree;
            if (node.record.evalScore === evalScore) return prevTree;
            return {
                ...prevTree,
                [nodeId]: {
                    ...node,
                    record: { ...node.record, evalScore },
                },
            };
        });
    }, []);

    const setNodeEvals = useCallback((updates: Array<{ nodeId: string; evalScore: number }>) => {
        if (updates.length === 0) return;
        setTreeNodes((prevTree) => {
            let nextTree = prevTree;

            for (const update of updates) {
                const { nodeId, evalScore } = update;
                if (!Number.isFinite(evalScore) || nodeId === ROOT_NODE_ID) continue;
                const node = nextTree[nodeId];
                if (!node?.record || node.record.evalScore === evalScore) continue;

                if (nextTree === prevTree) {
                    nextTree = { ...prevTree };
                }

                nextTree[nodeId] = {
                    ...node,
                    record: { ...node.record, evalScore },
                };
            }

            return nextTree;
        });
    }, []);

    const setNodeBestMove = useCallback((nodeId: string, bestMove: string) => {
        if (!bestMove || nodeId === ROOT_NODE_ID) return;
        setTreeNodes((prevTree) => {
            const node = prevTree[nodeId];
            if (!node?.record || node.record.bestMove === bestMove) return prevTree;
            return {
                ...prevTree,
                [nodeId]: { ...node, record: { ...node.record, bestMove } },
            };
        });
    }, []);

    // Returns true if a move was successfully applied.
    const onSquareClick = useCallback((file: number, rank: number): string | null => {
        const piece = board[rank][file];

        if (!selected) {
            if (piece && pieceSide(piece) === sideToMove) {
                setSelected({ file, rank });
                setValidTargets(legalMovesFrom(board, file, rank, sideToMove));
            }
            return null;
        }

        if (selected.file === file && selected.rank === rank) {
            setSelected(null);
            setValidTargets([]);
            return null;
        }

        if (piece && pieceSide(piece) === sideToMove) {
            setSelected({ file, rank });
            setValidTargets(legalMovesFrom(board, file, rank, sideToMove));
            return null;
        }

        const uci = squareToUci(selected.file, selected.rank) + squareToUci(file, rank);
        const moved = applyUciMove(uci);
        if (!moved) return null;
        return uci;
    }, [board, selected, sideToMove, applyUciMove]);

    return {
        board,
        sideToMove,
        moveHistory,
        currentMoveIndex,
        currentNodeId,
        rootNodeId: ROOT_NODE_ID,
        treeNodes,
        activeLineNodeIds,
        selected,
        validTargets,
        currentFen,
        inCheck,
        gameResult,
        setGameResult,
        onSquareClick,
        resetBoard,
        applyUciMove,
        setCurrentNodeEval,
        setNodeEval,
        setNodeEvals,
        setNodeBestMove,
        getNodeFen,
        loadMoves,
        loadFen,
        jumpToMove,
        jumpToNode,
    };
}
