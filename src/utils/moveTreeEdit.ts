import type { MoveTreeNode } from '../hooks/useXiangqi';

/**
 * Every node under `nodeId`, itself included, in no particular order.
 *
 * Iterative rather than recursive: a study tree can be long, and a line of a
 * few hundred plies is nothing unusual in a game record.
 */
export function collectSubtreeIds(treeNodes: Record<string, MoveTreeNode>, nodeId: string): string[] {
    if (!treeNodes[nodeId]) return [];
    const ids: string[] = [];
    const stack = [nodeId];
    while (stack.length > 0) {
        const id = stack.pop()!;
        ids.push(id);
        for (const childId of treeNodes[id]?.childrenIds ?? []) stack.push(childId);
    }
    return ids;
}

/**
 * The tree with `nodeId` and everything under it removed.
 *
 * Returns the same object when there is nothing to do -- the root, or an id
 * the tree does not hold -- so a caller can compare by identity. Every node on
 * the way is a fresh object, and the untouched nodes are shared, which is what
 * the React state update expects.
 */
export function removeSubtree(
    treeNodes: Record<string, MoveTreeNode>,
    rootNodeId: string,
    nodeId: string
): { tree: Record<string, MoveTreeNode>; removedIds: string[] } {
    const node = treeNodes[nodeId];
    if (!node || nodeId === rootNodeId || !node.parentId) {
        return { tree: treeNodes, removedIds: [] };
    }
    const removedIds = collectSubtreeIds(treeNodes, nodeId);
    const removed = new Set(removedIds);
    const tree: Record<string, MoveTreeNode> = {};
    for (const [id, entry] of Object.entries(treeNodes)) {
        if (removed.has(id)) continue;
        tree[id] = entry;
    }
    const parent = treeNodes[node.parentId];
    if (parent) {
        tree[node.parentId] = {
            ...parent,
            childrenIds: parent.childrenIds.filter((childId) => childId !== nodeId),
        };
    }
    return { tree, removedIds };
}
