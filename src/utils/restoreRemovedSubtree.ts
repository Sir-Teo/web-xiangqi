import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';

/** New annotations win when a deleted move has since been played again. */
function mergeRestoredRecord(removed: MoveRecord, current: MoveRecord): MoveRecord {
    const score = current.evalScore !== undefined ? current : removed;
    const review = current.quality !== undefined || current.bestMove !== undefined ? current : removed;
    return {
        ...removed,
        ...current,
        // Scores, depths and score kinds describe one observation, not fields
        // that can be mixed between the old and newly evaluated move.
        evalScore: score.evalScore,
        evalDepth: score.evalDepth,
        evalScoreKind: score.evalScoreKind,
        persistEvaluation: current.persistEvaluation ?? removed.persistEvaluation,
        quality: review.quality,
        bestMove: review.bestMove,
        bestLine: review.bestLine,
        swing: review.swing,
        winPercentLoss: review.winPercentLoss,
        reviewNote: review.reviewNote,
    };
}

/** Restore only the removed branch; later edits elsewhere remain authoritative. */
export function restoreRemovedSubtree(
    current: Record<string, MoveTreeNode>,
    before: Record<string, MoveTreeNode>,
    removedId: string,
    preserveFirstChildren = false,
): { tree: Record<string, MoveTreeNode>; restoredIds: Map<string, string> } | null {
    const removed = before[removedId];
    if (!removed?.parentId || !current[removed.parentId]) return null;
    const tree = { ...current };
    const restoredIds = new Map<string, string>();
    const stack = [{ oldId: removedId, parentId: removed.parentId }];
    while (stack.length) {
        const { oldId, parentId } = stack.pop()!;
        const old = before[oldId];
        const parent = tree[parentId];
        if (!old?.record || !parent || restoredIds.has(oldId)) return null;
        const existingId = parent.childrenIds.find(id => tree[id]?.record?.uci === old.record!.uci);
        const id = existingId ?? oldId;
        if (!existingId && tree[id]) return null; // Never overwrite an unrelated ID.
        restoredIds.set(oldId, id);
        if (existingId) {
            const existing = tree[id];
            tree[id] = { ...existing, record: mergeRestoredRecord(old.record, existing.record!) };
        } else {
            tree[id] = { ...old, id, parentId, childrenIds: [] };
            // Insert after the nearest surviving older sibling. New branches
            // keep their relative order and remain after the original ones.
            const siblings = before[old.parentId!]?.childrenIds ?? [];
            let insertAt = 0;
            for (const siblingId of siblings) {
                if (siblingId === oldId) break;
                const uci = before[siblingId]?.record?.uci;
                const index = parent.childrenIds.findIndex(child => tree[child]?.record?.uci === uci);
                if (index >= 0) insertAt = index + 1;
            }
            // A main line explicitly chosen after the deletion is newer user
            // intent. Restoring an old first sibling must not demote it.
            if (preserveFirstChildren && parent.childrenIds.length && insertAt === 0) insertAt = 1;
            const childrenIds = [...parent.childrenIds];
            childrenIds.splice(insertAt, 0, id);
            tree[parentId] = { ...parent, childrenIds };
        }
        for (let i = old.childrenIds.length - 1; i >= 0; i -= 1) {
            const childId = old.childrenIds[i];
            if (before[childId]?.parentId !== oldId) return null;
            stack.push({ oldId: childId, parentId: id });
        }
    }
    return { tree, restoredIds };
}
