import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';

/** New annotations win when a deleted move has since been played again. */
function mergeRestoredRecord(removed: MoveRecord, current: MoveRecord): MoveRecord {
    const score = current.evalScore !== undefined ? current : removed;
    const review = current.quality !== undefined || current.bestMove !== undefined ? current : removed;
    return {
        ...removed,
        ...current,
        // An own undefined value records an explicit clearing after replay.
        recordedResult: Object.hasOwn(current, 'recordedResult') ? current.recordedResult : removed.recordedResult,
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
    const claimed = new Set<string>();
    const ownedChildren = new Set<string>();
    const siblingPositions = new Map<string, Map<string, number>>();
    const replayedChildren = new Map<string, Map<string, string[]>>();
    const stack = [{ oldId: removedId, parentId: removed.parentId }];
    while (stack.length) {
        const { oldId, parentId } = stack.pop()!;
        const old = before[oldId];
        const parent = tree[parentId];
        if (!old?.record || !parent || restoredIds.has(oldId)) return null;
        // Only merge a newly replayed move, once. An older identical sibling
        // or another restored occurrence has its own annotations to retain.
        let replays = replayedChildren.get(parentId);
        if (!replays) {
            replays = new Map<string, string[]>();
            for (const childId of current[parentId]?.childrenIds ?? []) {
                const uci = !before[childId] ? current[childId]?.record?.uci : undefined;
                if (!uci) continue;
                const ids = replays.get(uci);
                if (ids) ids.push(childId); else replays.set(uci, [childId]);
            }
            for (const ids of replays.values()) ids.reverse();
            replayedChildren.set(parentId, replays);
        }
        const candidates = replays.get(old.record.uci);
        let existingId = candidates?.pop();
        while (existingId && claimed.has(existingId)) existingId = candidates?.pop();
        const id = existingId ?? oldId;
        if (!existingId && tree[id]) return null; // Never overwrite an unrelated ID.
        restoredIds.set(oldId, id);
        claimed.add(id);
        if (existingId) {
            const existing = tree[id];
            tree[id] = { ...existing, record: mergeRestoredRecord(old.record, existing.record!) };
        } else {
            tree[id] = { ...old, id, parentId, childrenIds: [] };
            ownedChildren.add(id);
            // Insert after the nearest surviving older sibling. New branches
            // keep their relative order and remain after the original ones.
            const siblings = before[old.parentId!]?.childrenIds ?? [];
            let positions = siblingPositions.get(old.parentId!);
            if (!positions && siblings.length > 1) {
                positions = new Map(siblings.map((sibling, index) => [sibling, index]));
                siblingPositions.set(old.parentId!, positions);
            }
            let insertAt = 0;
            for (let i = (positions?.get(oldId) ?? 0) - 1; i >= 0; i--) {
                const siblingId = siblings[i];
                const mapped = restoredIds.get(siblingId) ?? siblingId;
                const index = parent.childrenIds.at(-1) === mapped ? parent.childrenIds.length - 1 : parent.childrenIds.indexOf(mapped);
                if (index >= 0) { insertAt = index + 1; break; }
            }
            // A main line explicitly chosen after the deletion is newer user
            // intent. Restoring an old first sibling must not demote it.
            if (preserveFirstChildren && parent.childrenIds.length && insertAt === 0) insertAt = 1;
            // Clone each parent's list once; later inserts belong to this
            // transaction, including thousands of repeated annotated moves.
            const owned = ownedChildren.has(parentId);
            const childrenIds = owned ? parent.childrenIds : [...parent.childrenIds];
            childrenIds.splice(insertAt, 0, id);
            if (!owned) {
                tree[parentId] = { ...parent, childrenIds };
                ownedChildren.add(parentId);
            }
        }
        for (let i = old.childrenIds.length - 1; i >= 0; i -= 1) {
            const childId = old.childrenIds[i];
            if (before[childId]?.parentId !== oldId) return null;
            stack.push({ oldId: childId, parentId: id });
        }
    }
    return { tree, restoredIds };
}
