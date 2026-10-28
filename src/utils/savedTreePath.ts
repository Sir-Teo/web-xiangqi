import type { SavedMoveTreeNode } from './gameLibrary';
import { MAX_STUDY_LINE_MOVES, MAX_STUDY_TREE_NODES } from './studyLimits';

function prefixAtPath(nodes: SavedMoveTreeNode[] | undefined, moves: readonly string[], path: unknown): SavedMoveTreeNode[] | null {
    if (!Array.isArray(path) || path.length > moves.length || path.length > MAX_STUDY_LINE_MOVES) return null;
    let children = nodes ?? [];
    for (let depth = 0; depth < path.length; depth++) {
        const index = path[depth];
        if (!Number.isInteger(index) || index < 0 || index >= children.length) return null;
        const node = children[index];
        if (node.uci !== moves[depth]) return null;
        children = node.children ?? [];
    }
    return children;
}

/** Child indices distinguish identical moves with different study annotations. */
export function isSavedTreePath(nodes: SavedMoveTreeNode[] | undefined, moves: readonly string[], path: unknown): path is number[] {
    return Array.isArray(path) && path.length === moves.length && prefixAtPath(nodes, moves, path) !== null;
}

export function normalizeSavedTreePath(path: unknown, nodes: SavedMoveTreeNode[] | undefined, moves: readonly string[]): number[] | undefined {
    return isSavedTreePath(nodes, moves, path) && path.length ? path.slice() : undefined;
}

export function decodeSavedTreePathParam(raw: string | null, nodes: SavedMoveTreeNode[] | undefined, moves: readonly string[]): number[] | undefined {
    if (!raw || raw.length > MAX_STUDY_LINE_MOVES * 5) return undefined;
    const parts = raw.split('.');
    if (parts.some(part => !/^\d{1,4}$/.test(part))) return undefined;
    return normalizeSavedTreePath(parts.map(Number), nodes, moves);
}

function findPath(nodes: SavedMoveTreeNode[] | undefined, moves: readonly string[], offset: number): number[] | null {
    if (offset === moves.length) return [];
    const stack = [{ nodes: nodes ?? [], index: 0 }];
    const path: number[] = [];
    let visited = 0;
    while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.index >= frame.nodes.length) {
            stack.pop(); path.length = stack.length;
            continue;
        }
        const index = frame.index++;
        const node = frame.nodes[index];
        if (++visited > MAX_STUDY_TREE_NODES) return null;
        const depth = stack.length - 1;
        if (node.uci !== moves[offset + depth]) continue;
        path[depth] = index; path.length = depth + 1;
        if (offset + depth === moves.length - 1) return path;
        if (node.children?.length) stack.push({ nodes: node.children, index: 0 });
    }
    return null;
}

/** Backtrack through repeated sibling moves; a preferred prefix keeps its identity. */
export function findSavedTreePath(nodes: SavedMoveTreeNode[] | undefined, moves: readonly string[], preferred?: readonly number[]): number[] | null {
    if (moves.length > MAX_STUDY_LINE_MOVES) return null;
    if (preferred) {
        const children = prefixAtPath(nodes, moves, preferred);
        if (children) {
            const tail = findPath(children, moves, preferred.length);
            if (tail) return [...preferred, ...tail];
        }
    }
    return findPath(nodes, moves, 0);
}

export function savedNodeAtPath(nodes: SavedMoveTreeNode[] | undefined, path: readonly number[] | null): SavedMoveTreeNode | undefined {
    let children = nodes;
    let node: SavedMoveTreeNode | undefined;
    for (const index of path ?? []) {
        node = children?.[index];
        if (!node) return undefined;
        children = node.children;
    }
    return node;
}
