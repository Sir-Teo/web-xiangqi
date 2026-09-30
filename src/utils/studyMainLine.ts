import type { MoveTreeNode, MoveTreeStructure } from '../hooks/useXiangqi';

type Tree = Record<string, MoveTreeNode>;

/** A study's designated line follows first children; navigation is separate. */
export function getStudyMainLine(tree: MoveTreeStructure, rootId: string): string[] {
    const line: string[] = [];
    const seen = new Set([rootId]);
    let parentId = rootId;
    for (;;) {
        const id = tree[parentId]?.childrenIds[0];
        if (!id || seen.has(id) || !tree[id]?.record || tree[id].parentId !== parentId) return line;
        seen.add(id);
        line.push(id);
        parentId = id;
    }
}

/** Pin a selected line while preserving node IDs, records and the order of other siblings. */
export function pinStudyMainLine(tree: Tree, rootId: string, line: string[]): Tree {
    if (!tree[rootId] || !line.length) return tree;
    const parents: Array<{ parentId: string; childId: string }> = [];
    const seen = new Set([rootId]);
    let parentId = rootId;
    for (const childId of line) {
        if (seen.has(childId) || !tree[childId]?.record || tree[childId].parentId !== parentId
            || !tree[parentId].childrenIds.includes(childId)) return tree;
        seen.add(childId);
        parents.push({ parentId, childId });
        parentId = childId;
    }
    // A partial path would silently select an unspecified continuation.
    if (tree[parentId].childrenIds.length) return tree;
    const reordered = parents.filter(({ parentId, childId }) => tree[parentId].childrenIds[0] !== childId);
    if (tree[rootId].mainLinePinned && !reordered.length) return tree;
    const next = { ...tree };
    for (const { parentId, childId } of reordered) {
        const parent = next[parentId];
        next[parentId] = { ...parent, childrenIds: [childId, ...parent.childrenIds.filter(id => id !== childId)] };
    }
    next[rootId] = { ...next[rootId], mainLinePinned: true, mainLineRevision: (tree[rootId].mainLineRevision ?? 0) + 1 };
    return next;
}

export function unpinStudyMainLine(tree: Tree, rootId: string): Tree {
    const root = tree[rootId];
    return root?.mainLinePinned
        ? { ...tree, [rootId]: { ...root, mainLinePinned: undefined, mainLineRevision: (root.mainLineRevision ?? 0) + 1 } }
        : tree;
}
