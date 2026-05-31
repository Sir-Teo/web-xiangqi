import { memo, useEffect } from 'react';
import type { MoveTreeNode } from '../../hooks/useXiangqi';
import {
    getEvalLossForMove,
    getMoveQualityClassName,
    getReviewSideForRecord,
    isCriticalReviewQuality,
} from '../../utils/review';
import { formatMoveRecordLabel, formatMoveRecordTitle, formatUciMove } from '../../utils/moveNotation';
import { IconSpark, IconCornerDownRight } from '../icons';

type Props = {
    treeNodes: Record<string, MoveTreeNode>;
    rootNodeId: string;
    rootFen: string;
    currentNodeId: string;
    currentMoveIndex: number;
    activeLineNodeIds: string[];
    onNavigateNode: (nodeId: string) => void;
};

type MoveSide = 'w' | 'b';

type MoveListEntry = {
    nodeId: string;
    lineIndex: number;
    moveNumber: number;
    side: MoveSide;
};

export const MoveListTree = memo(function MoveListTree({
    treeNodes,
    rootNodeId,
    rootFen,
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
    const rootContext = parseRootMoveContext(rootFen);
    const entryAt = (lineIndex: number): MoveListEntry | null => {
        const nodeId = activeLineNodeIds[lineIndex];
        if (!nodeId) return null;
        return makeMoveListEntry(nodeId, lineIndex, rootContext);
    };

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
                    <span className="mtree-coach-hint" title={`Engine suggested: ${formatUciMove(coachMove)}`}>
                        <IconSpark /> {formatUciMove(coachMove)}
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
                    <IconCornerDownRight className="mtree-var-marker" />
                    {variationLine.map((nodeId) => renderMoveChip(nodeId, true))}
                </div>
            );
        });
    };

    let lineIndex = 0;
    while (lineIndex < activeLineNodeIds.length) {
        const entry = entryAt(lineIndex);
        if (!entry) break;

        let redEntry: MoveListEntry | null = null;
        let blackEntry: MoveListEntry | null = null;
        let consumed = 1;
        let rowLabel = `${entry.moveNumber}.`;

        if (entry.side === 'w') {
            redEntry = entry;
            const nextEntry = entryAt(lineIndex + 1);
            if (nextEntry?.side === 'b' && nextEntry.moveNumber === entry.moveNumber) {
                blackEntry = nextEntry;
                consumed = 2;
            }
        } else {
            blackEntry = entry;
            rowLabel = `${entry.moveNumber}...`;
        }

        const rowKey = redEntry?.nodeId ?? blackEntry?.nodeId ?? `row-${lineIndex}`;
        const rowIndex = rows.length;
        rows.push(
            <div key={`row-${rowKey}`} className="mtree-row">
                <span className="mtree-num" data-testid={`move-tree-row-label-${rowIndex}`}>{rowLabel}</span>
                {redEntry ? renderMoveChip(redEntry.nodeId) : <span className="mtree-spacer" />}
                {blackEntry ? renderMoveChip(blackEntry.nodeId) : <span className="mtree-spacer" />}
            </div>
        );

        if (lineIndex === 0) pushVariations(rootNodeId, -1);
        if (redEntry) pushVariations(redEntry.nodeId, redEntry.lineIndex);
        if (blackEntry) pushVariations(blackEntry.nodeId, blackEntry.lineIndex);
        lineIndex += consumed;
    }

    return (
        <div className="mtree-scroll">
            {rows}
            <div className="mtree-quality-legend">
                <span className="legend-title">Move loss</span>
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

function formatMoveLabel(record: NonNullable<MoveTreeNode['record']>) {
    return formatMoveRecordLabel(record);
}

function formatMoveTitle(record: NonNullable<MoveTreeNode['record']>) {
    return formatMoveRecordTitle(record);
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

function parseRootMoveContext(rootFen: string): { sideToMove: MoveSide; fullmove: number } {
    const parts = rootFen.trim().split(/\s+/);
    const sideToMove: MoveSide = parts[1] === 'b' ? 'b' : 'w';
    const parsedFullmove = Number(parts[5]);
    const fullmove = Number.isFinite(parsedFullmove) && parsedFullmove > 0
        ? Math.trunc(parsedFullmove)
        : 1;
    return { sideToMove, fullmove };
}

function makeMoveListEntry(
    nodeId: string,
    lineIndex: number,
    rootContext: { sideToMove: MoveSide; fullmove: number }
): MoveListEntry {
    const side: MoveSide = rootContext.sideToMove === 'w'
        ? (lineIndex % 2 === 0 ? 'w' : 'b')
        : (lineIndex % 2 === 0 ? 'b' : 'w');
    const blackRootOffset = rootContext.sideToMove === 'b' ? 1 : 0;
    return {
        nodeId,
        lineIndex,
        side,
        moveNumber: rootContext.fullmove + Math.floor((lineIndex + blackRootOffset) / 2),
    };
}

function getMoveQualityClass(treeNodes: Record<string, MoveTreeNode>, nodeId: string): string {
    const node = treeNodes[nodeId];
    const record = node?.record;
    if (record?.quality) {
        return getMoveQualityClassName(record.quality);
    }
    const currentEval = record?.evalScore;
    const parentEval = node?.parentId ? treeNodes[node.parentId]?.record?.evalScore : 0;
    if (!record || typeof currentEval !== 'number' || typeof parentEval !== 'number') return 'quality-pending';

    const side = getReviewSideForRecord(record, record.ply - 1);
    const delta = getEvalLossForMove(parentEval, currentEval, side);
    if (delta <= 40) return 'quality-best';
    if (delta <= 90) return 'quality-good';
    if (delta <= 180) return 'quality-inaccuracy';
    if (delta <= 320) return 'quality-mistake';
    return 'quality-blunder';
}
