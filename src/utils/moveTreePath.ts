/**
 * The moves from the root of the move tree down to a node.
 *
 * The engine needs these, not just the position it reaches. Pikafish detects
 * repetition from the move list, and in xiangqi a repetition is not a draw:
 * perpetual check and perpetual chase lose for the side forcing them. Handed a
 * bare FEN the engine has no history to apply those rules to, so it answers a
 * different question from the one the board is asking.
 *
 * Takes a structural node type rather than importing `MoveTreeNode` from the
 * hook, the way `review.ts` takes `ReviewTreeNodeLike`: it keeps this testable
 * without a React render and keeps utils from importing hooks.
 */
export interface MoveTreePathNode {
    parentId: string | null;
    record?: { uci?: string } | null;
}

export const MOVE_TREE_ROOT_ID = 'root';

export function getMovesToNode(
    treeNodes: Record<string, MoveTreePathNode | undefined>,
    nodeId: string,
    rootId: string = MOVE_TREE_ROOT_ID
): string[] {
    const moves: string[] = [];
    const seen = new Set<string>();
    let current: string | null = nodeId;

    while (current && current !== rootId) {
        // A tree that somehow points at itself must not hang the app; stopping
        // returns a short line, which the engine reads as a shallower history
        // rather than as nothing at all.
        if (seen.has(current)) break;
        seen.add(current);

        const node: MoveTreePathNode | undefined = treeNodes[current];
        const uci = node?.record?.uci;
        if (!uci) break;

        moves.push(uci);
        current = node.parentId;
    }

    return moves.reverse();
}

/** Store an address only when UCI moves alone would choose another sibling. */
export function distinctMoveTreePath(
    nodes: Record<string, { childrenIds: string[]; record?: { uci?: string } }>,
    rootId: string,
    nodeIds: readonly string[],
): number[] | undefined {
    const path: number[] = [];
    let parent = nodes[rootId];
    let ambiguous = false;
    for (const id of nodeIds) {
        const node = nodes[id];
        const index = parent?.childrenIds.indexOf(id) ?? -1;
        const uci = node?.record?.uci;
        if (index < 0 || !uci) return undefined;
        if (parent.childrenIds.findIndex(child => nodes[child]?.record?.uci === uci) !== index) ambiguous = true;
        path.push(index);
        parent = node;
    }
    return ambiguous ? path : undefined;
}
