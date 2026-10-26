import type { SavedMoveTreeNode } from './gameLibrary';

/**
 * A saved move tree as a flat list, for crossing a worker boundary.
 *
 * The tree nests one level per move, so a 1,000-move line is 1,000 levels deep,
 * and structured clone recurses on nesting: posting a dense backup's parsed
 * games from the PGN worker overflowed the worker's stack ("Maximum call stack
 * size exceeded") and the import failed. A flat list clones at any depth.
 *
 * Nodes are listed in pre-order with the index of their parent (-1 for a root
 * move), which is enough to rebuild the children in their original order.
 */
export type FlatMoveTreeNode = Omit<SavedMoveTreeNode, 'children'> & { parent: number };

export function flattenMoveTree(tree: readonly SavedMoveTreeNode[]): FlatMoveTreeNode[] {
    const flat: FlatMoveTreeNode[] = [];
    const stack: { node: SavedMoveTreeNode; parent: number }[] = [];
    for (let index = tree.length - 1; index >= 0; index--) stack.push({ node: tree[index], parent: -1 });
    while (stack.length) {
        const { node, parent } = stack.pop()!;
        const { children, ...fields } = node;
        const self = flat.length;
        flat.push({ ...fields, parent });
        if (children) {
            for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], parent: self });
        }
    }
    return flat;
}

export function inflateMoveTree(flat: readonly FlatMoveTreeNode[]): SavedMoveTreeNode[] {
    const roots: SavedMoveTreeNode[] = [];
    const nodes: SavedMoveTreeNode[] = [];
    for (const entry of flat) {
        if (!entry || typeof entry !== 'object' || typeof entry.uci !== 'string'
            || !Number.isInteger(entry.parent) || entry.parent < -1 || entry.parent >= nodes.length) {
            throw new Error('Invalid move tree transfer.');
        }
        const { parent, ...fields } = entry;
        const node: SavedMoveTreeNode = fields;
        nodes.push(node);
        if (parent < 0) {
            roots.push(node);
        } else {
            const owner = nodes[parent];
            (owner.children ??= []).push(node);
        }
    }
    return roots;
}

type WithMoveTree = { moveTree?: SavedMoveTreeNode[] };
export type PackedGame<T extends WithMoveTree> = Omit<T, 'moveTree'> & { flatMoveTree?: FlatMoveTreeNode[] };

/** Games as the PGN worker posts them: every move tree flattened. */
export function packCollectionGames<T extends WithMoveTree>(games: readonly T[]): PackedGame<T>[] {
    return games.map(({ moveTree, ...game }) => (moveTree ? { ...game, flatMoveTree: flattenMoveTree(moveTree) } : game));
}

export function unpackCollectionGames<T extends WithMoveTree>(games: readonly PackedGame<T>[]): T[] {
    return games.map(({ flatMoveTree, ...game }) => (flatMoveTree ? { ...game, moveTree: inflateMoveTree(flatMoveTree) } : game) as T);
}
