import { memo, useEffect } from 'react';
import type { MoveTreeNode } from '../../hooks/useXiangqi';

type Props = {
    treeNodes: Record<string, MoveTreeNode>;
    rootNodeId: string;
    currentNodeId: string;
    currentMoveIndex: number;
    activeLineNodeIds: string[];
    onNavigateNode: (nodeId: string) => void;
};

export const MoveListTree = memo(function MoveListTree({
    treeNodes,
    rootNodeId: _rootNodeId,
    currentNodeId,
    currentMoveIndex: _currentMoveIndex,
    activeLineNodeIds,
    onNavigateNode,
}: Props) {
    useEffect(() => {
        const el = document.querySelector(`[data-node-id="${currentNodeId}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentNodeId]);

    if (activeLineNodeIds.length === 0) {
        return (
            <div className="empty-state">
                <p>Play some moves - branches will appear here.</p>
            </div>
        );
    }

    const rows: JSX.Element[] = [];

    const renderMoveChip = (nodeId: string, compact = false) => {
        const node = treeNodes[nodeId];
        const record = node?.record;
        if (!node || !record) return null;
        const qualityClass = getMoveQualityClass(treeNodes, nodeId);
        return (
            <button
                key={nodeId}
                data-node-id={nodeId}
                type="button"
                className={[
                    'mtree-chip',
                    qualityClass,
                    compact ? 'mtree-chip-compact' : '',
                    currentNodeId === nodeId ? 'mtree-chip-active' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onNavigateNode(nodeId)}
                title={record.uci}
            >
                {formatMoveLabel(record)}
                <span className="move-uci">{record.uci}</span>
                {qualityClass !== 'quality-pending' ? <span className="mtree-quality-dot" /> : null}
            </button>
        );
    };

    const pushVariations = (parentId: string, lineIndex: number) => {
        const parent = treeNodes[parentId];
        if (!parent || parent.childrenIds.length <= 1) return;
        const mainChild = activeLineNodeIds[lineIndex + 1] ?? null;
        const variationRoots = parent.childrenIds.filter((childId) => childId !== mainChild);
        variationRoots.forEach((variationRootId) => {
            const variationLine = buildVariationLine(variationRootId, treeNodes);
            rows.push(
                <div key={`var-${parentId}-${variationRootId}`} className="mtree-variation">
                    <span className="mtree-var-marker">↳</span>
                    {variationLine.map((nodeId) => renderMoveChip(nodeId, true))}
                </div>
            );
        });
    };

    let index = 0;
    while (index < activeLineNodeIds.length) {
        const whiteNodeId = activeLineNodeIds[index];
        const blackNodeId = activeLineNodeIds[index + 1] ?? null;
        const moveNo = Math.ceil((index + 1) / 2);

        rows.push(
            <div key={`row-${whiteNodeId}`} className="mtree-row">
                <span className="mtree-num">{moveNo}.</span>
                {whiteNodeId ? renderMoveChip(whiteNodeId) : <span className="mtree-spacer" />}
                {blackNodeId ? renderMoveChip(blackNodeId) : <span className="mtree-spacer" />}
            </div>
        );

        pushVariations(whiteNodeId, index);
        if (blackNodeId) pushVariations(blackNodeId, index + 1);
        index += 2;
    }

    return <div className="mtree-scroll">{rows}</div>;
});

MoveListTree.displayName = 'MoveListTree';

function formatMoveLabel(record: NonNullable<MoveTreeNode['record']>) {
    return `${record.piece.toUpperCase()}${record.captured ? 'x' : '-'}${record.uci.substring(2, 4)}`;
}

function buildVariationLine(startId: string, treeNodes: Record<string, MoveTreeNode>): string[] {
    const line: string[] = [];
    let cursor: string | undefined = startId;
    let guard = 6;
    while (cursor && guard-- > 0) {
        line.push(cursor);
        const nextNodeId: string | undefined = treeNodes[cursor]?.childrenIds[0];
        cursor = nextNodeId;
    }
    return line;
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
