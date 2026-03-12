import { memo, useEffect } from 'react';
import type { MoveTreeNode } from '../../hooks/useXiangqi';
import { getMoveQualityClassName, isCriticalReviewQuality } from '../../utils/review';

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
        // Coach hint: engine's best alternative (stored on this node from review)
        const coachMove = record.bestMove && record.bestMove !== record.uci ? record.bestMove : null;
        const note = record.quality && isCriticalReviewQuality(record.quality) ? record.reviewNote : null;
        const isBadMove = record.quality ? isCriticalReviewQuality(record.quality) : qualityClass === 'quality-mistake' || qualityClass === 'quality-blunder';
        return (
            <span key={nodeId} className="mtree-chip-wrap">
                <button
                    data-node-id={nodeId}
                    data-testid={currentNodeId === nodeId ? 'move-tree-active' : undefined}
                    type="button"
                    className={[
                        'mtree-chip',
                        qualityClass,
                        compact ? 'mtree-chip-compact' : '',
                        currentNodeId === nodeId ? 'mtree-chip-active' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => onNavigateNode(nodeId)}
                    title={formatMoveTitle(record)}
                >
                    {formatMoveLabel(record)}
                    <span className="move-uci">{record.uci}</span>
                    {qualityClass !== 'quality-pending' ? <span className="mtree-quality-dot" /> : null}
                </button>
                {isBadMove && coachMove && (
                    <span className="mtree-coach-hint" title={`Engine suggested: ${coachMove}`}>
                        ✦ {coachMove}
                    </span>
                )}
                {note ? (
                    <span className="mtree-review-note" title={note}>
                        {note}
                    </span>
                ) : null}
            </span>
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

    return (
        <div className="mtree-scroll">
            {rows}
            <div className="mtree-quality-legend">
                <span className="legend-title">Move quality</span>
                <div className="legend-items">
                    <span className="legend-item quality-best"><span className="mtree-quality-dot" /> Best <em>≤40cp</em></span>
                    <span className="legend-item quality-good"><span className="mtree-quality-dot" /> Good <em>≤90cp</em></span>
                    <span className="legend-item quality-inaccuracy"><span className="mtree-quality-dot" /> Inaccuracy <em>≤180cp</em></span>
                    <span className="legend-item quality-mistake"><span className="mtree-quality-dot" /> Mistake <em>≤320cp</em></span>
                    <span className="legend-item quality-blunder"><span className="mtree-quality-dot" /> Blunder <em>&gt;320cp</em></span>
                </div>
            </div>
        </div>
    );
});

MoveListTree.displayName = 'MoveListTree';

const PIECE_CHAR: Record<string, string> = {
    'R': '車', 'r': '車',
    'N': '馬', 'n': '馬',
    'B': '象', 'b': '象',
    'A': '仕', 'a': '士',
    'K': '帥', 'k': '將',
    'C': '炮', 'c': '炮',
    'P': '兵', 'p': '卒',
};

function formatMoveLabel(record: NonNullable<MoveTreeNode['record']>) {
    return `${record.piece.toUpperCase()}${record.captured ? 'x' : '-'}${record.uci.substring(2, 4)}`;
}

function formatMoveTitle(record: NonNullable<MoveTreeNode['record']>) {
    const char = PIECE_CHAR[record.piece] ?? record.piece.toUpperCase();
    const from = record.uci.slice(0, 2);
    const to = record.uci.slice(2, 4);
    const action = record.captured ? '×' : '→';
    return `${char} ${from}${action}${to}`;
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
    if (node?.record?.quality) {
        return getMoveQualityClassName(node.record.quality);
    }
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
