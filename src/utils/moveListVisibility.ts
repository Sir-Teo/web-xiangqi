import type { MoveTreeNode } from '../hooks/useXiangqi';

export const MAX_VISIBLE_VARIATION_PLIES = 80;

/** Match the shortened side lines in MoveListTree without walking every branch. */
export function isMoveListNodeVisible(
    treeNodes: Record<string, MoveTreeNode>,
    rootNodeId: string,
    activeLineNodeIds: string[],
    nodeId: string,
): boolean {
    if (!activeLineNodeIds.length || !treeNodes[nodeId]?.record) return false;
    if (activeLineNodeIds.includes(nodeId)) return true;

    const activeLine = new Set(activeLineNodeIds);
    let cursor = nodeId;
    // Only the first 80 plies of a side line are rendered. Its continuation
    // follows the last child; other nested branches are hidden until opened.
    for (let depth = 0; depth < MAX_VISIBLE_VARIATION_PLIES; depth += 1) {
        const parentId = treeNodes[cursor]?.parentId;
        const parent = parentId ? treeNodes[parentId] : undefined;
        if (!parentId || !parent) return false;
        if (parentId === rootNodeId || activeLine.has(parentId)) {
            return parent.childrenIds.length > 1 && parent.childrenIds.includes(cursor);
        }
        if (parent.childrenIds.at(-1) !== cursor) return false;
        cursor = parentId;
    }
    return false;
}
