import { memo, useCallback, useEffect, useRef } from 'react';
import type { MoveTreeNode } from '../../hooks/useXiangqi';
import {
    REVIEW_THRESHOLDS,
    REVIEW_WIN_PERCENT_LOSS_THRESHOLDS,
    classifyMoveQualityForEval,
    formatReviewQuality,
    getEvalLossForMove,
    getMoveQualityClassName,
    getReviewSideForRecord,
    isCriticalReviewQuality,
} from '../../utils/review';
import { formatMoveRecordLabel, formatMoveRecordTitle, formatUciMove } from '../../utils/moveNotation';
import { describeMoveNumber } from '../../utils/moveNumbering';
import {
    boardBeforeRecord,
    formatMoveInStyle,
    formatRecordInStyle,
    type XiangqiNotationStyle,
} from '../../utils/xiangqiNotation';
import { IconSpark, IconCornerDownRight } from '../icons';

type Props = {
    treeNodes: Record<string, MoveTreeNode>;
    rootNodeId: string;
    rootFen: string;
    currentNodeId: string;
    currentMoveIndex: number;
    activeLineNodeIds: string[];
    notationStyle?: XiangqiNotationStyle;
    onNavigateNode: (nodeId: string) => void;
};

type MoveSide = 'w' | 'b';

type MoveListEntry = {
    nodeId: string;
    lineIndex: number;
    moveNumber: number;
    side: MoveSide;
};

const MAX_VISIBLE_VARIATION_PLIES = 80;

export const MoveListTree = memo(function MoveListTree({
    treeNodes,
    rootNodeId,
    rootFen,
    currentNodeId,
    currentMoveIndex: _currentMoveIndex,
    activeLineNodeIds,
    notationStyle = 'uci',
    onNavigateNode,
}: Props) {
    const scrollRef = useRef<HTMLDivElement | null>(null);

    const centreActiveMove = useCallback(() => {
        const container = scrollRef.current;
        const el = container?.querySelector(`[data-node-id="${currentNodeId}"]`) as HTMLElement | null;
        if (!container || !el) return;

        const containerRect = container.getBoundingClientRect();
        const activeRect = el.getBoundingClientRect();
        const rawTargetTop = container.scrollTop
            + activeRect.top
            - containerRect.top
            - (containerRect.height - activeRect.height) / 2;
        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const targetTop = Math.max(0, Math.min(maxTop, rawTargetTop));
        const distance = Math.abs(targetTop - container.scrollTop);
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const activeFullyVisible = activeRect.top >= containerRect.top && activeRect.bottom <= containerRect.bottom;
        const behavior: ScrollBehavior = prefersReducedMotion || !activeFullyVisible || distance > container.clientHeight * 1.5
            ? 'auto'
            : 'smooth';

        if (prefersReducedMotion) {
            el.scrollIntoView({ block: 'nearest', behavior });
        }
        if (distance > 1) {
            container.scrollTo({ top: targetTop, behavior });
        }
    }, [currentNodeId]);

    useEffect(() => { centreActiveMove(); }, [centreActiveMove]);

    // The panel holding this list is display:none while the board view is up, so
    // the moves that arrive during play centre against a 0x0 box: maxTop is 0,
    // the distance is 0, and the effect completes having done nothing. Coming
    // back to the tab changes no dependency, so the list stayed pinned at the
    // top with the current move below the fold. Re-centre when the box goes from
    // collapsed to laid out.
    useEffect(() => {
        const container = scrollRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return;
        let wasCollapsed = container.clientHeight === 0;
        const observer = new ResizeObserver(() => {
            const collapsed = container.clientHeight === 0;
            if (wasCollapsed && !collapsed) centreActiveMove();
            wasCollapsed = collapsed;
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [centreActiveMove]);

    if (activeLineNodeIds.length === 0) {
        return (
            <div className="empty-state">
                <p>No moves yet.</p>
            </div>
        );
    }

    const rows: JSX.Element[] = [];
    const hasMoveQualityLegend = activeLineNodeIds.some((nodeId) => (
        getMoveQualityClass(treeNodes, nodeId, rootNodeId) !== 'quality-pending'
    ));
    const entryAt = (lineIndex: number): MoveListEntry | null => {
        const nodeId = activeLineNodeIds[lineIndex];
        if (!nodeId) return null;
        return makeMoveListEntry(nodeId, lineIndex, rootFen);
    };

    const renderMoveChip = (nodeId: string, compact = false) => {
        const node = treeNodes[nodeId];
        const record = node?.record;
        if (!node || !record) return null;
        const qualityClass = getMoveQualityClass(treeNodes, nodeId, rootNodeId);
        // Coach hint: engine's best alternative (stored on this node from review)
        const coachMove = record.bestMove && record.bestMove !== record.uci ? record.bestMove : null;
        const note = record.quality && isCriticalReviewQuality(record.quality) ? record.reviewNote : null;
        const isBadMove = record.quality ? isCriticalReviewQuality(record.quality) : qualityClass === 'quality-mistake' || qualityClass === 'quality-blunder';
        const isCurrent = currentNodeId === nodeId;
        return (
            <span key={nodeId} className="mtree-chip-wrap">
                <button
                    data-node-id={nodeId}
                    data-testid={isCurrent ? 'move-tree-active' : undefined}
                    type="button"
                    className={[
                        'mtree-chip',
                        qualityClass,
                        compact ? 'mtree-chip-compact' : '',
                        isCurrent ? 'mtree-chip-active' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => onNavigateNode(nodeId)}
                    title={formatMoveTitle(record)}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={formatMoveAriaLabel(record, isCurrent, coachMove, notationStyle)}
                >
                    {/* One authoritative reading of the move, then the raw
                        coordinates as the cross-reference -- raw, because that
                        is the form you paste into an engine or a share link.
                        In UCI mode the reading already *is* the coordinates, so
                        the second line goes: it was printing `h2e2` under
                        `H2→E2`, which is the same move written twice. */}
                    {formatMoveLabel(record, notationStyle)}
                    {notationStyle === 'uci'
                        ? null
                        : <span className="move-uci">{record.uci}</span>}
                    {qualityClass !== 'quality-pending' ? <span className="mtree-quality-dot" /> : null}
                </button>
                {isBadMove && coachMove && (
                    <span className="mtree-coach-hint" title={`Engine suggested: ${formatUciMove(coachMove)}`}>
                        <IconSpark /> {formatAlternative(record, coachMove, notationStyle)}
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
        <div className="mtree-scroll" ref={scrollRef}>
            {rows}
            {hasMoveQualityLegend ? <div className="mtree-quality-legend">
                    <span className="legend-title">Move loss</span>
                    <div className="legend-items">
                        {/* Read the bounds off the thresholds the classifier uses, so the
                            legend cannot drift from what the dots actually mean. */}
                        {(['best', 'good', 'inaccuracy', 'mistake'] as const).map((quality) => (
                            <span key={quality} className={`legend-item quality-${quality}`}>
                                <span className="mtree-quality-dot" /> {formatReviewQuality(quality)}{' '}
                                <em>≤{REVIEW_THRESHOLDS[quality]}cp / {REVIEW_WIN_PERCENT_LOSS_THRESHOLDS[quality]}%</em>
                            </span>
                        ))}
                        <span className="legend-item quality-blunder"><span className="mtree-quality-dot" /> {formatReviewQuality('blunder')} <em>larger</em></span>
                    </div>
                    <p>Severity is capped by practical win-chance loss so lopsided positions are not over-punished.</p>
                </div> : null}
        </div>
    );
});

MoveListTree.displayName = 'MoveListTree';

function formatMoveLabel(
    record: NonNullable<MoveTreeNode['record']>,
    notationStyle: XiangqiNotationStyle
) {
    // WXF spells the piece out as a letter and Chinese as the same glyph the
    // board draws, so neither needs the glyph repeated in front of it.
    if (notationStyle !== 'uci') return formatMoveNotation(record, notationStyle);
    return formatMoveRecordLabel(record);
}

function formatMoveTitle(record: NonNullable<MoveTreeNode['record']>) {
    // Move quality reaches the eye only as the colour of a 5px dot, and forced
    // colours repaint that dot to its own background -- so the annotation was
    // there with no way at all to read it. The aria-label already carries the
    // quality; give the tooltip the same, which also spares a mouse user from
    // matching a colour against the legend.
    const title = formatMoveRecordTitle(record);
    return record.quality ? `${title} - ${formatReviewQuality(record.quality)}` : title;
}

function formatMoveNotation(
    record: NonNullable<MoveTreeNode['record']>,
    notationStyle: XiangqiNotationStyle
) {
    return formatRecordInStyle(record, notationStyle);
}

/**
 * A move the engine preferred, written in the same notation as the move it
 * replaces. It was played from the same position, so it reads off the same
 * board -- and showing "C2=5" beside a coordinate pair would make the two look
 * like different kinds of thing.
 */
function formatAlternative(
    record: NonNullable<MoveTreeNode['record']>,
    uci: string,
    notationStyle: XiangqiNotationStyle
) {
    if (notationStyle === 'uci') return formatUciMove(uci);
    const before = boardBeforeRecord(record);
    return before ? formatMoveInStyle(before, uci, notationStyle) : formatUciMove(uci);
}

function formatMoveAriaLabel(
    record: NonNullable<MoveTreeNode['record']>,
    isCurrent: boolean,
    coachMove: string | null,
    notationStyle: XiangqiNotationStyle
) {
    const notation = formatMoveNotation(record, notationStyle);
    const parts = [
        isCurrent ? 'Current move' : '',
        formatMoveRecordTitle(record),
        notationStyle === 'uci' ? '' : notation,
        `UCI ${formatUciMove(record.uci)}`,
        record.quality ? `Review quality ${formatReviewQuality(record.quality)}` : '',
        coachMove ? `Engine suggestion ${formatAlternative(record, coachMove, notationStyle)}` : '',
    ].filter(Boolean);
    return parts.join(', ');
}

function buildVariationLine(startId: string, treeNodes: Record<string, MoveTreeNode>): string[] {
    const line: string[] = [];
    let cursor: string | undefined = startId;
    const seen = new Set<string>();
    let guard = MAX_VISIBLE_VARIATION_PLIES;
    while (cursor && guard-- > 0 && !seen.has(cursor)) {
        seen.add(cursor);
        line.push(cursor);
        const children: string[] = treeNodes[cursor]?.childrenIds ?? [];
        const nextNodeId: string | undefined = children[children.length - 1];
        cursor = nextNodeId;
    }
    return line;
}

function makeMoveListEntry(
    nodeId: string,
    lineIndex: number,
    rootFen: string
): MoveListEntry {
    // `lineIndex` is 0-based and `describeMoveNumber` takes a 1-based ply, which
    // is what a MoveRecord stores. The arithmetic used to live here as well as
    // in `useXiangqi` and the breadcrumb; the breadcrumb is what proved that
    // three statements of one rule is two too many -- it had drifted into
    // numbering plies instead.
    const { moveNumber, side } = describeMoveNumber(rootFen, lineIndex + 1);
    return { nodeId, lineIndex, side, moveNumber };
}

function getMoveQualityClass(
    treeNodes: Record<string, MoveTreeNode>,
    nodeId: string,
    rootNodeId: string
): string {
    const node = treeNodes[nodeId];
    const record = node?.record;
    if (record?.quality) {
        return getMoveQualityClassName(record.quality);
    }
    const currentEval = record?.evalScore;
    /**
     * The root carries no record, so a first move has no parent evaluation to
     * be judged against and stayed `quality-pending` for the life of the game
     * -- every move but the first got a live colour. The `: 0` here was meant
     * to cover it and never fired: the root's id is a truthy string, so the
     * lookup ran and found nothing.
     *
     * Zero is the same baseline `EvalGraph` plots the start position at, so
     * the two now agree rather than one grading a move the other does not.
     * Both are wrong in the same way for a game set up from a lopsided
     * position, where the start is not even -- and a review, whose stored
     * quality is preferred above, is what corrects it.
     */
    const parentIsRoot = !node?.parentId || node.parentId === rootNodeId;
    const parentEval = parentIsRoot ? 0 : treeNodes[node.parentId!]?.record?.evalScore;
    if (!record || typeof currentEval !== 'number' || typeof parentEval !== 'number') return 'quality-pending';

    const side = getReviewSideForRecord(record, record.ply - 1);
    const delta = getEvalLossForMove(parentEval, currentEval, side);
    return getMoveQualityClassName(classifyMoveQualityForEval(delta, parentEval, currentEval, side));
}
