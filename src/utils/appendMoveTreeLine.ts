import { studyCapacityError, type StudyCapacityError } from './studyLimits';
import type { MoveTreeNode } from '../hooks/useXiangqi';
import { isInCheck, validateMoveStr, type BoardState, type Side } from './xiangqi';

export interface AppendedMoveTreeLine {
    tree: Record<string, MoveTreeNode>;
    tipId: string;
    nextNodeId: number;
    played: number;
    capacityError?: StudyCapacityError;
}

/** Add a legal prefix, reusing existing branches and copying the tree at most once. */
export function appendMoveTreeLine(
    tree: Record<string, MoveTreeNode>,
    parentId: string,
    moves: string[],
    rootBoard: BoardState,
    rootSide: Side,
    nextNodeId: number,
): AppendedMoveTreeLine {
    let nextTree = tree;
    const initialNextNodeId = nextNodeId;
    let nodeCount = Object.keys(tree).length - 1;
    let cursor = parentId;
    const parent = tree[parentId];
    let board = parent?.record?.board ?? rootBoard;
    let side = parent?.record?.sideToMove ?? rootSide;
    let ply = parent?.record?.ply ?? 0;
    let played = 0;
    if (!parent) return { tree, tipId: parentId, nextNodeId, played };

    for (const raw of moves) {
        const uci = String(raw || '').trim().toLowerCase();
        const validation = validateMoveStr(uci, board, side);
        if (!validation.ok || !validation.mv) break;
        const move = validation.mv;
        const nextBoard = board.map(row => [...row]);
        nextBoard[move.toRank][move.toFile] = validation.piece!;
        nextBoard[move.fromRank][move.fromFile] = '';
        const nextSide: Side = side === 'w' ? 'b' : 'w';
        ply++;
        const existing = nextTree[cursor].childrenIds.find(id => nextTree[id]?.record?.uci === uci);
        if (existing) {
            cursor = existing;
        } else {
            const capacityError = studyCapacityError(nodeCount + 1, ply);
            if (capacityError) return { tree, tipId: parentId, nextNodeId: initialNextNodeId, played: 0, capacityError };
            nodeCount++;
            if (nextTree === tree) nextTree = { ...tree };
            while (nextTree[`n${nextNodeId}`]) nextNodeId++;
            const id = `n${nextNodeId++}`;
            nextTree[cursor] = { ...nextTree[cursor], childrenIds: [...nextTree[cursor].childrenIds, id] };
            nextTree[id] = {
                id,
                parentId: cursor,
                childrenIds: [],
                record: {
                    uci,
                    piece: validation.piece!,
                    captured: validation.captured || '',
                    board: nextBoard,
                    sideToMove: nextSide,
                    inCheck: isInCheck(nextBoard, nextSide),
                    ply,
                },
            };
            cursor = id;
        }
        board = nextBoard;
        side = nextSide;
        played++;
    }
    return { tree: nextTree, tipId: cursor, nextNodeId, played };
}

/** Whether the entire continuation is already present beneath this position. */
export function hasMoveTreeLine(tree: Record<string, MoveTreeNode>, parentId: string, moves: string[]): boolean {
    if (!moves.length || !tree[parentId]) return false;
    let cursor = parentId;
    for (const uci of moves) {
        const child = tree[cursor].childrenIds.find(id => tree[id]?.record?.uci === uci);
        if (!child) return false;
        cursor = child;
    }
    return true;
}
