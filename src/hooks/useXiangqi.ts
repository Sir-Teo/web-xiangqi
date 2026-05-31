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
    findKing,
    inPalace,
    isInCheck,
    kingsFacing,
    hasAnyLegalMove,
} from '../utils/xiangqi';
import type { ReviewMoveQuality } from '../utils/review';

export type GameResult = 'red-wins' | 'black-wins' | 'draw' | null;

export interface MoveRecord {
    uci: string;
    piece: string;
    captured: string;
    evalScore?: number;
    bestMove?: string; // engine's best move from the parent position (set during review)
    quality?: ReviewMoveQuality;
    swing?: number;
    reviewNote?: string;
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

export type MoveSequenceValidation =
    | { ok: true }
    | { ok: false; failedIndex: number; move: string; reason: string };

interface RootPosition {
    board: BoardState;
    sideToMove: Side;
    inCheck: boolean;
    fullmove: number;
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

function createStartRootPosition(): RootPosition {
    return {
        board: parseFenBoard(START_FEN),
        sideToMove: 'w',
        inCheck: false,
        fullmove: 1,
    };
}

function parseRootPositionFromFen(fen: string): RootPosition | null {
    try {
        const parts = fen.trim().split(/\s+/);
        if (parts.length < 2) return null;
        const board = parseFenBoard(parts[0]);
        const flat = board.flat();
        if (flat.filter((piece) => piece === 'K').length !== 1) return null;
        if (flat.filter((piece) => piece === 'k').length !== 1) return null;
        const sideChar = parts[1];
        if (sideChar !== 'w' && sideChar !== 'b') return null;
        const side: Side = sideChar === 'b' ? 'b' : 'w';
        const redKing = findKing(board, 'w');
        const blackKing = findKing(board, 'b');
        if (!redKing || !blackKing) return null;
        if (!inPalace('w', redKing.file, redKing.rank)) return null;
        if (!inPalace('b', blackKing.file, blackKing.rank)) return null;
        if (kingsFacing(board)) return null;
        const parsedFullmove = Number(parts[5]);
        const fullmove = Number.isFinite(parsedFullmove) && parsedFullmove > 0
            ? Math.trunc(parsedFullmove)
            : 1;
        return {
            board,
            sideToMove: side,
            inCheck: isInCheck(board, side),
            fullmove,
        };
    } catch {
        return null;
    }
}

function fullmoveForPly(rootPosition: RootPosition, ply: number) {
    const normalizedPly = Math.max(0, Math.trunc(ply));
    const blackRootOffset = rootPosition.sideToMove === 'b' ? 1 : 0;
    return rootPosition.fullmove + Math.floor((normalizedPly + blackRootOffset) / 2);
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

function getPositionFromNode(treeNodes: Record<string, MoveTreeNode>, nodeId: string, rootPosition: RootPosition) {
    if (nodeId === ROOT_NODE_ID) {
        return {
            board: rootPosition.board,
            sideToMove: rootPosition.sideToMove,
            inCheck: rootPosition.inCheck,
        };
    }
    const node = treeNodes[nodeId];
    if (!node?.record) {
        return {
            board: rootPosition.board,
            sideToMove: rootPosition.sideToMove,
            inCheck: rootPosition.inCheck,
        };
    }
    return {
        board: node.record.board,
        sideToMove: node.record.sideToMove,
        inCheck: node.record.inCheck,
    };
}

function repetitionKey(board: BoardState, sideToMove: Side) {
    return boardToFen(board, sideToMove, 1).split(/\s+/).slice(0, 2).join(' ');
}

function countPositionOccurrences(
    rootPosition: RootPosition,
    treeNodes: Record<string, MoveTreeNode>,
    lineNodeIds: string[],
    targetKey: string
) {
    let count = repetitionKey(rootPosition.board, rootPosition.sideToMove) === targetKey ? 1 : 0;
    for (const nodeId of lineNodeIds) {
        const record = treeNodes[nodeId]?.record;
        if (!record) continue;
        if (repetitionKey(record.board, record.sideToMove) === targetKey) {
            count += 1;
        }
    }
    return count;
}

function gameResultForPosition(
    rootPosition: RootPosition,
    treeNodes: Record<string, MoveTreeNode>,
    lineNodeIds: string[],
    board: BoardState,
    sideToMove: Side
): GameResult {
    if (!hasAnyLegalMove(board, sideToMove)) {
        return sideToMove === 'w' ? 'black-wins' : 'red-wins';
    }

    const posKey = repetitionKey(board, sideToMove);
    return countPositionOccurrences(rootPosition, treeNodes, lineNodeIds, posKey) >= 3 ? 'draw' : null;
}

export function useXiangqi() {
    const [treeNodes, setTreeNodes] = useState<Record<string, MoveTreeNode>>(() => createRootTree());
    const [rootPosition, setRootPosition] = useState<RootPosition>(() => createStartRootPosition());
    const [activeLineNodeIds, setActiveLineNodeIds] = useState<string[]>([]);
    const [currentMoveIndex, setCurrentMoveIndex] = useState<number>(-1);

    const [board, setBoard] = useState<BoardState>(() => parseFenBoard(START_FEN));
    const [sideToMove, setSideToMove] = useState<Side>('w');
    const [selected, setSelected] = useState<{ file: number; rank: number } | null>(null);
    const [validTargets, setValidTargets] = useState<{ file: number; rank: number; capture: boolean }[]>([]);
    const [inCheck, setInCheck] = useState<boolean>(false);
    const [gameResult, setGameResult] = useState<GameResult>(null);

    const nodeCounterRef = useRef(1);

    const currentNodeId = currentMoveIndex >= 0 ? activeLineNodeIds[currentMoveIndex] ?? ROOT_NODE_ID : ROOT_NODE_ID;
    const moveHistory = useMemo(
        () => activeLineNodeIds.map((nodeId) => treeNodes[nodeId]?.record).filter((record): record is MoveRecord => Boolean(record)),
        [activeLineNodeIds, treeNodes]
    );
    const currentFen = boardToFen(board, sideToMove, fullmoveForPly(rootPosition, currentMoveIndex + 1));
    const rootFen = boardToFen(rootPosition.board, rootPosition.sideToMove, rootPosition.fullmove);

    const syncPositionForNode = useCallback((nextTree: Record<string, MoveTreeNode>, nodeId: string) => {
        const position = getPositionFromNode(nextTree, nodeId, rootPosition);
        setBoard(position.board);
        setSideToMove(position.sideToMove);
        setInCheck(position.inCheck);
        setSelected(null);
        setValidTargets([]);
    }, [rootPosition]);

    const resetBoard = useCallback(() => {
        const rootTree = createRootTree();
        const root = createStartRootPosition();
        setTreeNodes(rootTree);
        setRootPosition(root);
        setActiveLineNodeIds([]);
        setCurrentMoveIndex(-1);
        setBoard(root.board);
        setSideToMove(root.sideToMove);
        setSelected(null);
        setValidTargets([]);
        setInCheck(root.inCheck);
        setGameResult(null);
        nodeCounterRef.current = 1;
    }, []);

    const loadFen = useCallback((fen: string): boolean => {
        const root = parseRootPositionFromFen(fen);
        if (!root) return false;
        const rootTree = createRootTree();
        const nextGameResult = gameResultForPosition(root, rootTree, [], root.board, root.sideToMove);
        setTreeNodes(rootTree);
        setRootPosition(root);
        setActiveLineNodeIds([]);
        setCurrentMoveIndex(-1);
        setBoard(root.board);
        setSideToMove(root.sideToMove);
        setSelected(null);
        setValidTargets([]);
        setInCheck(root.inCheck);
        setGameResult(nextGameResult);
        nodeCounterRef.current = 1;
        return true;
    }, []);

    const validateMoveSequence = useCallback((moves: string[], startFen?: string): MoveSequenceValidation => {
        const root = startFen ? parseRootPositionFromFen(startFen) : createStartRootPosition();
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
    }, []);

    const loadMoves = useCallback((moves: string[], startFen?: string) => {
        const root = startFen ? parseRootPositionFromFen(startFen) ?? createStartRootPosition() : createStartRootPosition();
        let currentBoard = root.board;
        let currentSide: Side = root.sideToMove;
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
        setRootPosition(root);
        setTreeNodes(tree);
        setActiveLineNodeIds(activeLine);
        setCurrentMoveIndex(lastIndex);
        setBoard(currentBoard);
        setSideToMove(currentSide);
        setInCheck(isInCheck(currentBoard, currentSide));
        setGameResult(gameResultForPosition(root, tree, activeLine, currentBoard, currentSide));
        setSelected(null);
        setValidTargets([]);
        return activeLine;
    }, []); // no deps — uses only local vars and stable refs

    const jumpToNode = useCallback((nodeId: string) => {
        const targetId = nodeId && treeNodes[nodeId] ? nodeId : ROOT_NODE_ID;
        const path = findPathToNode(treeNodes, targetId);
        const continuation = preferredContinuation(treeNodes, targetId);
        const nextActiveLine = [...path, ...continuation];
        const nextIndex = path.length - 1;

        setActiveLineNodeIds(nextActiveLine);
        setCurrentMoveIndex(nextIndex);
        const position = getPositionFromNode(treeNodes, targetId, rootPosition);
        setGameResult(gameResultForPosition(rootPosition, treeNodes, path, position.board, position.sideToMove));
        syncPositionForNode(treeNodes, targetId);
    }, [rootPosition, treeNodes, syncPositionForNode]);

    const jumpToMove = useCallback((index: number) => {
        if (index < -1 || index >= activeLineNodeIds.length) return;
        const nodeId = index === -1 ? ROOT_NODE_ID : activeLineNodeIds[index];
        const path = activeLineNodeIds.slice(0, index + 1);
        const position = getPositionFromNode(treeNodes, nodeId, rootPosition);
        setCurrentMoveIndex(index);
        setGameResult(gameResultForPosition(rootPosition, treeNodes, path, position.board, position.sideToMove));
        syncPositionForNode(treeNodes, nodeId);
    }, [activeLineNodeIds, rootPosition, treeNodes, syncPositionForNode]);

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

        const activePrefix = activeLineNodeIds.slice(0, currentMoveIndex + 1);

        const parentNodeId = currentNodeId;
        const parentNode = treeNodes[parentNodeId];
        const existingChildId = parentNode?.childrenIds.find((childId) => treeNodes[childId]?.record?.uci === mv.raw);

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
            setGameResult(gameResultForPosition(rootPosition, nextTree, [...activePrefix, existingChildId], nextBoard, nextSide));
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
        setGameResult(gameResultForPosition(rootPosition, nextTree, [...activePrefix, newNodeId], nextBoard, nextSide));
        syncPositionForNode(nextTree, newNodeId);
        return true;
    }, [board, sideToMove, currentNodeId, treeNodes, activeLineNodeIds, currentMoveIndex, rootPosition, syncPositionForNode]);

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
        const pos = getPositionFromNode(treeNodes, nodeId, rootPosition);
        const node = treeNodes[nodeId];
        const ply = node?.record?.ply ?? 0;
        return boardToFen(pos.board, pos.sideToMove, fullmoveForPly(rootPosition, ply));
    }, [rootPosition, treeNodes]);

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

    const setNodeReviewDataBulk = useCallback((updates: Array<{
        nodeId: string;
        evalScore?: number;
        bestMove?: string;
        quality?: ReviewMoveQuality;
        swing?: number;
        reviewNote?: string;
    }>) => {
        if (updates.length === 0) return;
        setTreeNodes((prevTree) => {
            let nextTree = prevTree;

            for (const update of updates) {
                if (update.nodeId === ROOT_NODE_ID) continue;
                const node = nextTree[update.nodeId];
                const record = node?.record;
                if (!record) continue;

                const nextRecord: MoveRecord = {
                    ...record,
                    evalScore: typeof update.evalScore === 'number' ? update.evalScore : record.evalScore,
                    bestMove: update.bestMove ?? record.bestMove,
                    quality: update.quality,
                    swing: typeof update.swing === 'number' ? update.swing : undefined,
                    reviewNote: update.reviewNote,
                };

                const changed =
                    nextRecord.evalScore !== record.evalScore ||
                    nextRecord.bestMove !== record.bestMove ||
                    nextRecord.quality !== record.quality ||
                    nextRecord.swing !== record.swing ||
                    nextRecord.reviewNote !== record.reviewNote;
                if (!changed) continue;

                if (nextTree === prevTree) {
                    nextTree = { ...prevTree };
                }

                nextTree[update.nodeId] = {
                    ...node,
                    record: nextRecord,
                };
            }

            return nextTree;
        });
    }, []);

    const clearAllReviewData = useCallback(() => {
        setTreeNodes((prevTree) => {
            let nextTree = prevTree;

            for (const [nodeId, node] of Object.entries(prevTree)) {
                const record = node.record;
                if (!record) continue;
                if (
                    record.bestMove === undefined &&
                    record.quality === undefined &&
                    record.swing === undefined &&
                    record.reviewNote === undefined
                ) {
                    continue;
                }

                if (nextTree === prevTree) {
                    nextTree = { ...prevTree };
                }

                nextTree[nodeId] = {
                    ...node,
                    record: {
                        ...record,
                        bestMove: undefined,
                        quality: undefined,
                        swing: undefined,
                        reviewNote: undefined,
                    },
                };
            }

            return nextTree;
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
        rootFen,
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
        setNodeReviewDataBulk,
        clearAllReviewData,
        getNodeFen,
        loadMoves,
        validateMoveSequence,
        loadFen,
        jumpToMove,
        jumpToNode,
    };
}
