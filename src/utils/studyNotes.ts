import type { MoveTreeNode } from '../hooks/useXiangqi';

export type StudyNote = {
    nodeId: string;
    comment: string;
    /** The nearest side-line entry, independent of the currently viewed line. */
    variationId?: string;
};

/** Visit every reachable position in tree order, including collapsed variations. */
export function collectStudyNotes(tree: Record<string, MoveTreeNode>, rootId: string): StudyNote[] {
    const notes: StudyNote[] = [];
    const seen = new Set<string>();
    const pending: { nodeId: string; variationId?: string }[] = [{ nodeId: rootId }];
    while (pending.length) {
        const { nodeId, variationId } = pending.pop()!;
        const node = tree[nodeId];
        if (!node || seen.has(nodeId)) continue;
        seen.add(nodeId);
        const comment = nodeId === rootId ? node.comment : node.record?.comment;
        if (comment?.trim()) notes.push({ nodeId, comment, variationId });
        for (let index = node.childrenIds.length - 1; index >= 0; index--) {
            const childId = node.childrenIds[index];
            pending.push({ nodeId: childId, variationId: index > 0 ? childId : variationId });
        }
    }
    return notes;
}
