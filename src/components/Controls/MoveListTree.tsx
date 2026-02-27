import { useEffect } from 'react';
import type { MoveTreeNode } from '../../hooks/useXiangqi';

type Props = {
    treeNodes: Record<string, MoveTreeNode>;
    rootNodeId: string;
    currentNodeId: string;
    currentMoveIndex: number;
    activeLineNodeIds: string[];
    onNavigateNode: (nodeId: string) => void;
};

type FlatNode = {
    id: string;
    depth: number;
    label: string;
    moveNo: string;
    uci: string;
    qualityClass: string;
};

export function MoveListTree({
    treeNodes,
    rootNodeId,
    currentNodeId,
    currentMoveIndex,
    activeLineNodeIds,
    onNavigateNode,
}: Props) {
    useEffect(() => {
        const el = document.querySelector(`[data-node-id="node-${currentNodeId}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentNodeId]);

    const activeLine = new Set(activeLineNodeIds);
    const flatRows = flattenTree(treeNodes, rootNodeId);

    const totalNodeCount = Math.max(0, Object.keys(treeNodes).length - 1);

    return (
        <div className="mtree-wrap">
            <div className="mtree-head">
                <button
                    type="button"
                    className={`mtree-chip mtree-chip-root ${currentNodeId === rootNodeId ? 'mtree-chip-active' : ''}`}
                    onClick={() => onNavigateNode(rootNodeId)}
                >
                    Start Position
                </button>
                <span className="mtree-progress">
                    Ply {Math.max(0, currentMoveIndex + 1)} · Nodes {totalNodeCount}
                </span>
            </div>
            {flatRows.length === 0 ? (
                <div className="empty-state" style={{ padding: '12px 4px', color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', textAlign: 'center' }}>
                    <p>Play some moves - branches will appear here.</p>
                </div>
            ) : (
                <div className="mtree-scroll">
                    {flatRows.map((row) => (
                        <div key={row.id} className="mtree-tree-row">
                            <span className="mtree-node-meta">{row.moveNo}</span>
                            <button
                                data-node-id={`node-${row.id}`}
                                type="button"
                                className={`mtree-tree-chip ${row.qualityClass} ${activeLine.has(row.id) ? 'mtree-tree-chip-line' : ''} ${currentNodeId === row.id ? 'mtree-chip-active' : ''}`}
                                onClick={() => onNavigateNode(row.id)}
                                style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                                title={row.uci}
                            >
                                {row.depth > 0 ? <span className="mtree-depth-marker">↳</span> : null}
                                <span>{row.label}</span>
                                <span className="move-uci">{row.uci}</span>
                                <span className="mtree-quality-dot" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function flattenTree(treeNodes: Record<string, MoveTreeNode>, rootNodeId: string): FlatNode[] {
    const rows: FlatNode[] = [];

    const walk = (parentId: string, depth: number) => {
        const parent = treeNodes[parentId];
        if (!parent) return;
        parent.childrenIds.forEach((childId) => {
            const child = treeNodes[childId];
            const record = child?.record;
            if (!child || !record) return;

            const moveNo = record.ply % 2 === 1
                ? `${Math.ceil(record.ply / 2)}.`
                : `${Math.ceil(record.ply / 2)}...`;

            rows.push({
                id: childId,
                depth,
                label: formatMoveLabel(record),
                moveNo,
                uci: record.uci,
                qualityClass: getMoveQualityClass(treeNodes, childId),
            });

            walk(childId, depth + 1);
        });
    };

    walk(rootNodeId, 0);
    return rows;
}

function formatMoveLabel(record: NonNullable<MoveTreeNode['record']>) {
    return `${record.piece.toUpperCase()}${record.captured ? 'x' : '-'}${record.uci.substring(2, 4)}`;
}

function getMoveQualityClass(treeNodes: Record<string, MoveTreeNode>, nodeId: string): string {
    const node = treeNodes[nodeId];
    const currentEval = node?.record?.evalScore;
    const parentEval = node?.parentId ? treeNodes[node.parentId]?.record?.evalScore : 0;
    if (typeof currentEval !== 'number' || typeof parentEval !== 'number') return 'quality-pending';

    const delta = Math.abs(currentEval - parentEval);
    if (delta <= 40) return 'quality-best';
    if (delta <= 90) return 'quality-good';
    if (delta <= 180) return 'quality-inaccuracy';
    if (delta <= 320) return 'quality-mistake';
    return 'quality-blunder';
}
