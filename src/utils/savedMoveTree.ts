import type { MoveTreeNode } from '../hooks/useXiangqi';
import type { SavedMoveTreeNode } from './gameLibrary';

/**
 * The move tree as it is written to storage and to a share link.
 *
 * This is the shape of everything a study contains, so a bug here loses the
 * variations someone built rather than showing them wrong. It was one of the
 * three helpers `docs/architecture.md` named as carrying enough logic to
 * deserve a test if they were ever touched, and it is the one that handles the
 * user's own work.
 *
 * ## The `seen` set is not decoration
 *
 * The tree is a `Record` of nodes referring to each other by id, not a nested
 * object, so nothing in the type stops a cycle -- and a cycle here is infinite
 * recursion during a save, which takes the tab with it. `seen` is copied per
 * branch rather than shared, so a node reachable down two different branches is
 * written under both, which is what a move that transposes should do. A single
 * shared set would silently drop the second branch's whole subtree.
 *
 * A childless node is written as `{ uci }` with no `children` key, which is
 * what the reader treats as equivalent to an empty array and what keeps a
 * share link short.
 */
export function serializeSavedMoveTree(
    treeNodes: Record<string, MoveTreeNode>,
    parentId: string,
    seen = new Set<string>()
): SavedMoveTreeNode[] {
    const parent = treeNodes[parentId];
    if (!parent || seen.has(parentId)) return [];

    const nextSeen = new Set(seen);
    nextSeen.add(parentId);
    return parent.childrenIds
        .map((childId): SavedMoveTreeNode | null => {
            const child = treeNodes[childId];
            const uci = child?.record?.uci;
            if (!child || !uci) return null;
            const children = serializeSavedMoveTree(treeNodes, childId, nextSeen);
            return children.length > 0 ? { uci, children } : { uci };
        })
        .filter((node): node is SavedMoveTreeNode => Boolean(node));
}
