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
    otherSide,
} from '../utils/xiangqi';
import type { ReviewMoveQuality } from '../utils/review';
import { getMovesToNode } from '../utils/moveTreePath';
import { removeSubtree } from '../utils/moveTreeEdit';
import { isSameMoveComment, normalizeMoveComment } from '../utils/moveComment';

export type GameResult = 'red-wins' | 'black-wins' | 'draw' | null;

export interface MoveRecord {
    uci: string;
    piece: string;
    captured: string;
    evalScore?: number;
    bestMove?: string; // engine's best move from the parent position (set during review)
    quality?: ReviewMoveQuality;
    swing?: number;
    winPercentLoss?: number;
    reviewNote?: string;
    /**
     * A note the reader wrote, kept apart from `reviewNote`, which the review
     * writes and overwrites on every re-run. See `utils/moveComment`.
     */
    comment?: string;
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

export type MoveTreeSnapshot = {
    treeNodes: Record<string, MoveTreeNode>;
    activeLineNodeIds: string[];
    currentMoveIndex: number;
    rootFen: string;
};

export type MoveSequenceValidation =
    | { ok: true }
    | { ok: false; failedIndex: number; move: string; reason: string };

export type SerializableMoveTreeNode = {
    uci: string;
    /** The reader's note on this move, when they wrote one. */
    comment?: string;
    children?: SerializableMoveTreeNode[];
};

function logMoveDiagnosticWarning(message: string, ...details: unknown[]) {
    if (import.meta.env.DEV) {
        console.warn(message, ...details);
    }
}

function logMoveDiagnosticError(message: string, ...details: unknown[]) {
    if (import.meta.env.DEV) {
        console.error(message, ...details);
    }
}

interface RootPosition {
    board: BoardState;
    sideToMove: Side;
    inCheck: boolean;
    fullmove: number;
    /**
     * Plies since the last capture, as the starting FEN stated them. Kept
     * because Pikafish adjudicates the natural limit from this field, so a
     * position pasted mid-endgame that arrives claiming zero is a different
     * position to the engine than the one the reader pasted.
     */
    halfmove: number;
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
        halfmove: 0,
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
        if (isInCheck(board, otherSide(side))) return null;
        const parsedFullmove = Number(parts[5]);
        const fullmove = Number.isFinite(parsedFullmove) && parsedFullmove > 0
            ? Math.trunc(parsedFullmove)
            : 1;
        const parsedHalfmove = Number(parts[4]);
        const halfmove = Number.isFinite(parsedHalfmove) && parsedHalfmove > 0
            ? Math.trunc(parsedHalfmove)
            : 0;
        return {
            board,
            sideToMove: side,
            inCheck: isInCheck(board, side),
            fullmove,
            halfmove,
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

/**
 * The halfmove clock at a node: plies since the last capture.
 *
 * Walked from the node's own ancestry rather than stored on the record, so it
 * stays right when a line is replayed, branched or loaded, and there is no
 * second copy of it to fall out of step. The root's own value comes from the
 * FEN the game started from.
 */
function halfmoveForNode(
    treeNodes: Record<string, MoveTreeNode>,
    nodeId: string,
    rootPosition: RootPosition
): number {
    const path = findPathToNode(treeNodes, nodeId);
    let clock = rootPosition.halfmove;
    for (const id of path) {
        const record = treeNodes[id]?.record;
        if (!record) continue;
        clock = record.captured ? 0 : clock + 1;
    }
    return clock;
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

function gameResultForPosition(board: BoardState, sideToMove: Side): GameResult {
    if (!hasAnyLegalMove(board, sideToMove)) {
        return sideToMove === 'w' ? 'black-wins' : 'red-wins';
    }

    // Xiangqi repetition adjudication depends on perpetual check/chase patterns,
    // so a repeated board position alone is not enough to end the game.
    return null;
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
    const currentFen = boardToFen(
        board,
        sideToMove,
        fullmoveForPly(rootPosition, currentMoveIndex + 1),
        halfmoveForNode(treeNodes, activeLineNodeIds[currentMoveIndex] ?? ROOT_NODE_ID, rootPosition)
    );
    const rootFen = boardToFen(
        rootPosition.board,
        rootPosition.sideToMove,
        rootPosition.fullmove,
        rootPosition.halfmove
    );

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
        const nextGameResult = gameResultForPosition(root.board, root.sideToMove);
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

    const validateMoveTree = useCallback((moveTree: SerializableMoveTreeNode[], startFen?: string): MoveSequenceValidation => {
        const root = startFen ? parseRootPositionFromFen(startFen) : createStartRootPosition();
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
        setGameResult(gameResultForPosition(currentBoard, currentSide));
        setSelected(null);
        setValidTargets([]);
        return activeLine;
    }, []); // no deps — uses only local vars and stable refs

    const loadMoveTree = useCallback((moveTree: SerializableMoveTreeNode[], mainLineMoves: string[], startFen?: string) => {
        const root = startFen ? parseRootPositionFromFen(startFen) ?? createStartRootPosition() : createStartRootPosition();
        const tree: Record<string, MoveTreeNode> = createRootTree();
        let counter = 1;

        const appendChildren = (
            children: SerializableMoveTreeNode[] | undefined,
            parentNodeId: string,
            parentBoard: BoardState,
            parentSide: Side,
            plyIndex: number
        ) => {
            if (!children?.length) return;

            for (const child of children) {
                const uci = String(child.uci || '').trim().toLowerCase();
                const from = uciToSquare(uci.substring(0, 2));
                const to = uciToSquare(uci.substring(2, 4));
                if (!from || !to) continue;
                const mv = { fromFile: from.file, fromRank: from.rank, toFile: to.file, toRank: to.rank, raw: uci };
                const result = validatePieceMove(parentBoard, mv, parentSide);
                if (!result.ok) continue;

                const nextBoard = parentBoard.map(row => [...row]) as BoardState;
                nextBoard[to.rank][to.file] = result.piece || '';
                nextBoard[from.rank][from.file] = '';
                const nextSide: Side = parentSide === 'w' ? 'b' : 'w';
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
                        ply: plyIndex + 1,
                        ...(normalizeMoveComment(child.comment) ? { comment: normalizeMoveComment(child.comment) } : {}),
                    },
                };

                appendChildren(child.children, nodeId, nextBoard, nextSide, plyIndex + 1);
            }
        };

        appendChildren(moveTree, ROOT_NODE_ID, root.board, root.sideToMove, 0);

        const activeLine: string[] = [];
        let cursor = ROOT_NODE_ID;
        for (const move of mainLineMoves) {
            const childId = tree[cursor]?.childrenIds.find((id) => tree[id]?.record?.uci === move);
            if (!childId) break;
            activeLine.push(childId);
            cursor = childId;
        }

        if (activeLine.length === 0 && tree[ROOT_NODE_ID].childrenIds.length > 0) {
            cursor = ROOT_NODE_ID;
            while (tree[cursor]?.childrenIds.length) {
                const childId = tree[cursor].childrenIds[0];
                activeLine.push(childId);
                cursor = childId;
            }
        }

        const shouldKeepRootSelected = mainLineMoves.length === 0;
        const activeNodeId = shouldKeepRootSelected ? ROOT_NODE_ID : activeLine[activeLine.length - 1] ?? ROOT_NODE_ID;
        const position = getPositionFromNode(tree, activeNodeId, root);
        nodeCounterRef.current = counter;
        setRootPosition(root);
        setTreeNodes(tree);
        setActiveLineNodeIds(activeLine);
        setCurrentMoveIndex(shouldKeepRootSelected ? -1 : activeLine.length - 1);
        setBoard(position.board);
        setSideToMove(position.sideToMove);
        setInCheck(position.inCheck);
        setGameResult(gameResultForPosition(position.board, position.sideToMove));
        setSelected(null);
        setValidTargets([]);
        return activeLine;
    }, []);

    const jumpToNode = useCallback((nodeId: string) => {
        const targetId = nodeId && treeNodes[nodeId] ? nodeId : ROOT_NODE_ID;
        const path = findPathToNode(treeNodes, targetId);
        const continuation = preferredContinuation(treeNodes, targetId);
        const nextActiveLine = [...path, ...continuation];
        const nextIndex = path.length - 1;

        setActiveLineNodeIds(nextActiveLine);
        setCurrentMoveIndex(nextIndex);
        const position = getPositionFromNode(treeNodes, targetId, rootPosition);
        setGameResult(gameResultForPosition(position.board, position.sideToMove));
        syncPositionForNode(treeNodes, targetId);
    }, [rootPosition, treeNodes, syncPositionForNode]);

    /**
     * Remove a move and every move after it, on every branch under it.
     *
     * The active line is cut at the node and re-extended from its parent
     * along whatever branch remains, so the board keeps a line to stand on.
     * If the position on screen was inside what was removed, the board steps
     * back to the parent -- the last position that still exists.
     */
    const deleteNode = useCallback((nodeId: string): boolean => {
        const { tree: nextTree, removedIds } = removeSubtree(treeNodes, ROOT_NODE_ID, nodeId);
        if (removedIds.length === 0) return false;
        const parentId = treeNodes[nodeId]?.parentId ?? ROOT_NODE_ID;
        const removed = new Set(removedIds);
        const cutAt = activeLineNodeIds.findIndex((id) => removed.has(id));
        setTreeNodes(nextTree);
        if (cutAt === -1) return true;

        const prefix = activeLineNodeIds.slice(0, cutAt);
        const nextActiveLine = [...prefix, ...preferredContinuation(nextTree, parentId)];
        setActiveLineNodeIds(nextActiveLine);
        if (currentMoveIndex >= cutAt) {
            const nextIndex = cutAt - 1;
            setCurrentMoveIndex(nextIndex);
            const position = getPositionFromNode(nextTree, parentId, rootPosition);
            setGameResult(gameResultForPosition(position.board, position.sideToMove));
            syncPositionForNode(nextTree, parentId);
        }
        return true;
    }, [activeLineNodeIds, currentMoveIndex, rootPosition, syncPositionForNode, treeNodes]);

    /**
     * The tree as it stands, so a deletion can be taken back.
     *
     * Everything a delete changes is here and nothing else: the nodes, the
     * line the board is on, and where on it the board stands. The root FEN is
     * carried so a snapshot from before a New Game or an import is refused
     * rather than grafted onto a different position.
     */
    const captureTreeSnapshot = useCallback((): MoveTreeSnapshot => ({
        treeNodes,
        activeLineNodeIds,
        currentMoveIndex,
        rootFen,
    }), [activeLineNodeIds, currentMoveIndex, rootFen, treeNodes]);

    const restoreTreeSnapshot = useCallback((snapshot: MoveTreeSnapshot): boolean => {
        if (snapshot.rootFen !== rootFen) return false;
        const nodeId = snapshot.currentMoveIndex === -1
            ? ROOT_NODE_ID
            : snapshot.activeLineNodeIds[snapshot.currentMoveIndex];
        if (!snapshot.treeNodes[nodeId]) return false;
        setTreeNodes(snapshot.treeNodes);
        setActiveLineNodeIds(snapshot.activeLineNodeIds);
        setCurrentMoveIndex(snapshot.currentMoveIndex);
        const position = getPositionFromNode(snapshot.treeNodes, nodeId, rootPosition);
        setGameResult(gameResultForPosition(position.board, position.sideToMove));
        syncPositionForNode(snapshot.treeNodes, nodeId);
        return true;
    }, [rootFen, rootPosition, syncPositionForNode]);

    const jumpToMove = useCallback((index: number) => {
        if (index < -1 || index >= activeLineNodeIds.length) return;
        const nodeId = index === -1 ? ROOT_NODE_ID : activeLineNodeIds[index];
        const position = getPositionFromNode(treeNodes, nodeId, rootPosition);
        setCurrentMoveIndex(index);
        setGameResult(gameResultForPosition(position.board, position.sideToMove));
        syncPositionForNode(treeNodes, nodeId);
    }, [activeLineNodeIds, rootPosition, treeNodes, syncPositionForNode]);

    const applyUciMoveAtNode = useCallback((parentNodeId: string, uci: string, evalScore?: number) => {
        const parentNode = treeNodes[parentNodeId];
        if (!parentNode) return false;

        const normalizedUci = String(uci || '').trim().toLowerCase();
        if (!/^[a-i][0-9][a-i][0-9]$/.test(normalizedUci)) {
            logMoveDiagnosticError('Invalid UCI move format:', uci);
            return false;
        }

        const fromSquare = normalizedUci.substring(0, 2);
        const toSquare = normalizedUci.substring(2, 4);

        const from = uciToSquare(fromSquare);
        const to = uciToSquare(toSquare);

        if (!from || !to) {
            logMoveDiagnosticError('Invalid UCI move format:', uci);
            return false;
        }

        const parentPosition = getPositionFromNode(treeNodes, parentNodeId, rootPosition);
        const parentBoard = parentPosition.board;
        const parentSide = parentPosition.sideToMove;
        const mv = {
            fromFile: from.file,
            fromRank: from.rank,
            toFile: to.file,
            toRank: to.rank,
            raw: normalizedUci
        };

        const result = validatePieceMove(parentBoard, mv, parentSide);
        if (!result.ok) {
            logMoveDiagnosticWarning('Invalid programmatic move (engine move rejected):', result.reason, uci, 'Side:', parentSide, 'Piece:', parentBoard[mv.fromRank][mv.fromFile]);
            return false;
        }

        const nextBoard = parentBoard.map((row) => [...row]);
        nextBoard[to.rank][to.file] = result.piece || '';
        nextBoard[from.rank][from.file] = '';

        const nextSide = parentSide === 'w' ? 'b' : 'w';
        const nextInCheck = isInCheck(nextBoard, nextSide);

        const activePrefix = findPathToNode(treeNodes, parentNodeId);
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

            const activeFutureStartsWithExistingMove =
                parentNodeId === currentNodeId &&
                activeLineNodeIds[currentMoveIndex + 1] === existingChildId;
            const keptFuture = activeFutureStartsWithExistingMove
                ? activeLineNodeIds.slice(currentMoveIndex + 1)
                : [existingChildId, ...preferredContinuation(nextTree, existingChildId)];
            const nextActiveLine = [...activePrefix, ...keptFuture];
            const nextIndex = activePrefix.length;

            setActiveLineNodeIds(nextActiveLine);
            setCurrentMoveIndex(nextIndex);
            setGameResult(gameResultForPosition(nextBoard, nextSide));
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
            ply: activePrefix.length + 1,
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
        setGameResult(gameResultForPosition(nextBoard, nextSide));
        syncPositionForNode(nextTree, newNodeId);
        return true;
    }, [activeLineNodeIds, currentMoveIndex, currentNodeId, rootPosition, syncPositionForNode, treeNodes]);

    const applyUciMove = useCallback((uci: string, evalScore?: number) => {
        return applyUciMoveAtNode(currentNodeId, uci, evalScore);
    }, [applyUciMoveAtNode, currentNodeId]);

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
        return boardToFen(
            pos.board,
            pos.sideToMove,
            fullmoveForPly(rootPosition, ply),
            halfmoveForNode(treeNodes, nodeId, rootPosition)
        );
    }, [rootPosition, treeNodes]);

    const getNodeMoves = useCallback((nodeId: string): string[] => (
        getMovesToNode(treeNodes, nodeId, ROOT_NODE_ID)
    ), [treeNodes]);

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

    /**
     * The reader's own note on a move. Passing an empty comment clears it, so
     * "cleared" and "never written" end up the same stored state.
     */
    const setNodeComment = useCallback((nodeId: string, comment: string) => {
        if (nodeId === ROOT_NODE_ID) return;
        const normalized = normalizeMoveComment(comment);
        setTreeNodes((prevTree) => {
            const node = prevTree[nodeId];
            if (!node?.record || isSameMoveComment(node.record.comment, normalized)) return prevTree;
            const record = { ...node.record };
            if (normalized) record.comment = normalized;
            else delete record.comment;
            return { ...prevTree, [nodeId]: { ...node, record } };
        });
    }, []);

    /**
     * Notes for many moves at once, which is what an import produces. One state
     * update rather than one per move: a pasted record may carry a thousand.
     */
    const setNodeComments = useCallback((updates: Array<{ nodeId: string; comment: string }>) => {
        if (updates.length === 0) return;
        setTreeNodes((prevTree) => {
            let changed = false;
            const nextTree = { ...prevTree };
            for (const { nodeId, comment } of updates) {
                if (nodeId === ROOT_NODE_ID) continue;
                const node = nextTree[nodeId];
                const normalized = normalizeMoveComment(comment);
                if (!node?.record || !normalized || isSameMoveComment(node.record.comment, normalized)) continue;
                nextTree[nodeId] = { ...node, record: { ...node.record, comment: normalized } };
                changed = true;
            }
            return changed ? nextTree : prevTree;
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
        winPercentLoss?: number;
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
                    winPercentLoss: typeof update.winPercentLoss === 'number' ? update.winPercentLoss : undefined,
                    reviewNote: update.reviewNote,
                };

                const changed =
                    nextRecord.evalScore !== record.evalScore ||
                    nextRecord.bestMove !== record.bestMove ||
                    nextRecord.quality !== record.quality ||
                    nextRecord.swing !== record.swing ||
                    nextRecord.winPercentLoss !== record.winPercentLoss ||
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
                    record.winPercentLoss === undefined &&
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
                        winPercentLoss: undefined,
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
        applyUciMoveAtNode,
        setCurrentNodeEval,
        setNodeEval,
        setNodeEvals,
        setNodeBestMove,
        setNodeComment,
        setNodeComments,
        setNodeReviewDataBulk,
        clearAllReviewData,
        getNodeFen,
        getNodeMoves,
        loadMoves,
        loadMoveTree,
        validateMoveTree,
        validateMoveSequence,
        loadFen,
        jumpToMove,
        jumpToNode,
        deleteNode,
        captureTreeSnapshot,
        restoreTreeSnapshot,
    };
}
