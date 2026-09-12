import { normalizeRecordedResult } from './recordedResult';
import { normalizeStudyAnalysis } from './studyAnalysis';
import { normalizeMoveEvaluation } from './moveEvaluation';
import { normalizeMoveGlyphs } from './moveGlyphs';
import type { MoveTreeNode } from '../hooks/useXiangqi';
import type { SavedMoveTreeNode } from './gameLibrary';
import { normalizeMoveComment } from './moveComment';

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
 * traversal during a save, which takes the tab with it. Track only ancestors
 * on the current path, removing each on exit, so shared subtrees are written
 * under every branch. A global visited set would silently lose variations.
 * An explicit stack avoids recursive call limits and copying the entire path
 * for every node in a long study.
 *
 * A childless node is written as `{ uci }` with no `children` key, which is
 * what the reader treats as equivalent to an empty array and what keeps a
 * share link short. A move with no note omits `comment` for the same reason:
 * the share link's tree budget is 8000 characters of JSON, and an empty string
 * per node would spend it on nothing.
 */
export function serializeSavedMoveTree(
    treeNodes: Record<string, MoveTreeNode>,
    parentId: string,
    seen = new Set<string>()
): SavedMoveTreeNode[] {
    const parent = treeNodes[parentId];
    if (!parent || seen.has(parentId)) return [];

    const output: SavedMoveTreeNode[] = [];
    const ancestors = new Set(seen);
    ancestors.add(parentId);
    const stack: Array<{ id: string; index: number; output: SavedMoveTreeNode[]; owner?: SavedMoveTreeNode }> = [
        { id: parentId, index: 0, output },
    ];
    while (stack.length) {
        const frame = stack[stack.length - 1];
        const childrenIds = treeNodes[frame.id].childrenIds;
        if (frame.index === childrenIds.length) {
            if (frame.owner && frame.output.length) frame.owner.children = frame.output;
            ancestors.delete(frame.id);
            stack.pop();
            continue;
        }
        const childId = childrenIds[frame.index++];
        const child = treeNodes[childId];
        const uci = child?.record?.uci;
        if (!uci) continue;
        const comment = normalizeMoveComment(child.record?.comment);
        const analysis = normalizeStudyAnalysis(child.record?.analysis, undefined, uci);
        const nags = normalizeMoveGlyphs(child.record?.nags);
        const saved: SavedMoveTreeNode = { uci, ...(nags ? { nags } : {}), ...(normalizeRecordedResult(child.record?.recordedResult) ? { recordedResult: normalizeRecordedResult(child.record?.recordedResult) } : {}), ...(comment ? { comment } : {}), ...(analysis ? { analysis } : {}), ...(child.record?.persistEvaluation ? normalizeMoveEvaluation(child.record) : {}) };
        frame.output.push(saved);
        // Retain the repeated move itself, matching the existing cycle guard,
        // but do not follow its children a second time along this path.
        if (ancestors.has(childId) || child.childrenIds.length === 0) continue;
        ancestors.add(childId);
        stack.push({ id: childId, index: 0, output: [], owner: saved });
    }
    return output;
}
