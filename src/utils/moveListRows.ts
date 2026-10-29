import type { MoveTreeStructure } from '../hooks/useXiangqi';
import { describeMoveNumber } from './moveNumbering';

const MAX_VISIBLE_VARIATION_PLIES = 80;

export type MoveListRow = { key: string; nodeIds: string[]; label?: string; parentId?: string; variationRootId?: string; remaining?: number };

export function buildMoveListRows(tree: MoveTreeStructure, rootId: string, line: readonly string[], rootFen: string): MoveListRow[] {
    const rows: MoveListRow[] = [];
    const variations = (parentId: string, nextIndex: number) => {
        const parent = tree[parentId];
        if (!parent || parent.childrenIds.length < 2) return;
        for (const start of parent.childrenIds) {
            if (start === line[nextIndex]) continue;
            const nodeIds: string[] = [], seen = new Set<string>();
            let cursor: string | undefined = start, remaining = 0;
            while (cursor && !seen.has(cursor)) {
                seen.add(cursor);
                if (nodeIds.length < MAX_VISIBLE_VARIATION_PLIES) nodeIds.push(cursor); else remaining++;
                cursor = tree[cursor]?.childrenIds.at(-1);
            }
            rows.push({ key: `var-${parentId}-${start}`, nodeIds, parentId, variationRootId: start, remaining });
        }
    };
    for (let index = 0; index < line.length;) {
        const entry = describeMoveNumber(rootFen, index + 1);
        const first = index;
        const nodeIds = [line[index++]];
        if (entry.side === 'w' && index < line.length) nodeIds.push(line[index++]);
        rows.push({ key: `row-${nodeIds[0]}`, nodeIds, label: entry.side === 'w' ? `${entry.moveNumber}.` : `${entry.moveNumber}...` });
        if (first === 0) variations(rootId, 0);
        for (let ply = first; ply < index; ply++) variations(line[ply], ply + 1);
    }
    return rows;
}

/** Rendering and keyboard focus share the same shortened variation model. */
export function buildMoveListNavigation(rows: readonly MoveListRow[], tree: MoveTreeStructure) {
    const ids: string[] = [], rowByNode = new Map<string, number>();
    rows.forEach((row, index) => row.nodeIds.forEach(id => {
        if (tree[id]?.record) { ids.push(id); rowByNode.set(id, index); }
    }));
    return { ids, rowByNode };
}
