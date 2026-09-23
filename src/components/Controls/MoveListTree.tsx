import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MoveTreeNode } from '../../hooks/useXiangqi';
import {
    REVIEW_THRESHOLDS,
    REVIEW_WIN_PERCENT_LOSS_THRESHOLDS,
    formatReviewQuality,
    getMoveQualityClassName,
    isCriticalReviewQuality,
    formatReviewNoteForDisplay,
    type ReviewMoveQuality,
} from '../../utils/review';
import { getMoveListQuality } from '../../utils/moveListQuality';
import { isMoveListNodeVisible, MAX_VISIBLE_VARIATION_PLIES } from '../../utils/moveListVisibility';
import { describeMoveWithCheck, formatMoveRecordLabel, formatUciMove } from '../../utils/moveNotation';
import { summarizeMoveComment } from '../../utils/moveComment';
import { describeMoveGlyphs, glyphSymbol } from '../../utils/moveGlyphs';
import { describeMoveNumber } from '../../utils/moveNumbering';
import {
    boardBeforeRecord,
    formatMoveInStyle,
    formatRecordInStyle,
    type XiangqiNotationStyle,
} from '../../utils/xiangqiNotation';
import { IconSpark, IconCornerDownRight, IconX } from '../icons';

type Props = {
    treeNodes: Record<string, MoveTreeNode>;
    rootNodeId: string;
    rootFen: string;
    currentNodeId: string;
    currentMoveIndex: number;
    activeLineNodeIds: string[];
    notationStyle?: XiangqiNotationStyle;
    onNavigateNode: (nodeId: string) => void;
    /** Offered on each variation row; the main line is never deletable from here. */
    onDeleteNode?: (nodeId: string) => void;
    onShowBoard?: () => void;
    onOpenLibrary?: () => void;
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
    notationStyle = 'uci',
    onNavigateNode,
    onDeleteNode,
    onShowBoard,
    onOpenLibrary,
}: Props) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const pendingVariationFocus = useRef<{ nodeId: string; element: Element } | null>(null);
    const pendingDeleteFocus = useRef<{ parentId: string; element: Element } | null>(null);

    const handleNavigateClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const chip = event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>('.mtree-chip') : null;
        const nodeId = chip?.dataset.nodeId;
        if (!chip || !nodeId || !event.currentTarget.contains(chip)) return;
        const focused = document.activeElement;
        // Opening a side line reparents its chips into main-line rows. Remember
        // focus only when activation came from the variation being replaced.
        pendingVariationFocus.current = focused
            && scrollRef.current?.contains(focused)
            && focused.getAttribute('data-node-id') === nodeId
            && focused.closest('.mtree-variation')
            ? { nodeId, element: focused } : null;
        onNavigateNode(nodeId);
    }, [onNavigateNode]);

    useEffect(() => {
        const pending = pendingVariationFocus.current;
        pendingVariationFocus.current = null;
        if (!pending || pending.element.isConnected || document.activeElement !== document.body) return;
        const target = scrollRef.current?.querySelector<HTMLButtonElement>('.mtree-chip-active');
        if (target?.dataset.nodeId === pending.nodeId) target.focus({ preventScroll: true });
    }, [activeLineNodeIds]);

    useEffect(() => {
        const pending = pendingDeleteFocus.current;
        pendingDeleteFocus.current = null;
        if (!pending || pending.element.isConnected || document.activeElement !== document.body) return;
        const container = scrollRef.current;
        // Return to the position where this variation branched. Root branches
        // have no parent chip, so keep the reader on the current visible move.
        const parent = Array.from(container?.querySelectorAll<HTMLButtonElement>('.mtree-chip') ?? [])
            .find(chip => chip.dataset.nodeId === pending.parentId);
        const target = parent ?? container?.querySelector<HTMLButtonElement>('.mtree-chip-active')
            ?? container?.querySelector<HTMLButtonElement>('.mtree-chip[tabindex="0"]')
            ?? container?.querySelector<HTMLButtonElement>('.mtree-chip');
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [treeNodes]);

    /**
     * One tab stop for the whole list, with the arrow keys inside it.
     *
     * Every chip was a tab stop, so a 100-ply game put a hundred presses of
     * Tab between the toolbar and Save. The breadcrumb and the board fixed
     * theirs; this was the half `docs/architecture.md` left open, because
     * the list is two-dimensional -- rows of Red and Black, with variation
     * rows between them -- and needed a decision about what Up and Down do.
     * They move a row: to the chip nearest horizontally, so Down from a Red
     * move lands on the next Red move and Down into a variation row lands
     * on whatever is under it. Left and Right walk the chips in reading
     * order, variations included, which is the order the eye takes.
     *
     * The stop follows focus, then the current move, then the first move,
     * so tabbing away and back returns to where the reader was.
     */
    const [rovingNodeId, setRovingNodeId] = useState<string | null>(null);
    const rovingNodeIsVisible = useMemo(() => rovingNodeId !== null
        && isMoveListNodeVisible(treeNodes, rootNodeId, activeLineNodeIds, rovingNodeId),
    [treeNodes, rootNodeId, activeLineNodeIds, rovingNodeId]);
    const stopNodeId = rovingNodeIsVisible
        ? rovingNodeId
        : treeNodes[currentNodeId]?.record
            ? currentNodeId
            : activeLineNodeIds[0] ?? null;

    const handleChipKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        const { key } = event;
        if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return;
        const container = scrollRef.current;
        if (!container) return;
        const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('.mtree-chip'));
        const index = chips.indexOf(event.currentTarget);
        if (index === -1) return;

        let target: HTMLButtonElement | undefined;
        if (key === 'ArrowLeft') target = chips[Math.max(0, index - 1)];
        else if (key === 'ArrowRight') target = chips[Math.min(chips.length - 1, index + 1)];
        else if (key === 'Home') target = chips[0];
        else if (key === 'End') target = chips[chips.length - 1];
        else {
            const pair = container.querySelector('.mtree-pair:has(> .mtree-chip-wrap + .mtree-chip-wrap)');
            const stacked = !pair || getComputedStyle(pair).gridTemplateColumns.split(' ').length === 1;
            const rowOf = (chip: HTMLButtonElement) => {
                const row = chip.closest('.mtree-row, .mtree-variation');
                return stacked && row?.classList.contains('mtree-row') ? chip : row;
            };
            const rows: HTMLButtonElement[][] = [];
            for (const chip of chips) {
                const row = rowOf(chip);
                const last = rows[rows.length - 1];
                if (last && rowOf(last[0]) === row) last.push(chip);
                else rows.push([chip]);
            }
            const rowIndex = rows.findIndex((row) => row.includes(event.currentTarget));
            const nextRow = rows[rowIndex + (key === 'ArrowDown' ? 1 : -1)];
            if (!nextRow) return;
            const x = event.currentTarget.getBoundingClientRect().left;
            target = nextRow.reduce((best, chip) => (
                Math.abs(chip.getBoundingClientRect().left - x) < Math.abs(best.getBoundingClientRect().left - x) ? chip : best
            ), nextRow[0]);
        }
        if (!target || target === event.currentTarget) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
    }, []);

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

    // Mounting while the panel expands can initially measure its collapsed
    // width. Reflow then moves the active row away from that scroll position.
    // Recenter after visible size changes, including panel resizing and text
    // enlargement, once the list has dimensions it can actually use.
    useEffect(() => {
        const container = scrollRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return;
        let previousWidth = 0;
        let previousHeight = 0;
        const observer = new ResizeObserver(() => {
            const width = container.clientWidth;
            const height = container.clientHeight;
            if (width > 0 && height > 0 && (width !== previousWidth || height !== previousHeight)) centreActiveMove();
            previousWidth = width;
            previousHeight = height;
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [centreActiveMove]);

    if (activeLineNodeIds.length === 0) {
        return (
            <div className="empty-state move-tree-empty">
                <strong>No moves yet</strong>
                <p>Play a move on the board or open a game to explore its move tree.</p>
                <div className="move-tree-empty-actions">
                    {onShowBoard ? <button type="button" onClick={onShowBoard}>Go to board</button> : null}
                    {onOpenLibrary ? <button type="button" onClick={onOpenLibrary}>Open library</button> : null}
                </div>
            </div>
        );
    }

    const rows: JSX.Element[] = [];
    let hasMoveQualityLegend = false;
    let hasEstimatedQuality = false;
    let hasSavedQualityMarks = false;
    const entryAt = (lineIndex: number): MoveListEntry | null => {
        const nodeId = activeLineNodeIds[lineIndex];
        if (!nodeId) return null;
        return makeMoveListEntry(nodeId, lineIndex, rootFen);
    };

    const renderMoveChip = (nodeId: string, compact = false) => {
        const node = treeNodes[nodeId];
        const record = node?.record;
        if (!node || !record) return null;
        const quality = getMoveListQuality(record, node.parentId ? treeNodes[node.parentId]?.record?.evalScore : undefined);
        if (quality) {
            hasMoveQualityLegend = true;
            if (!record.quality) hasEstimatedQuality = true;
            if (record.quality && record.persistEvaluation) hasSavedQualityMarks = true;
        }
        return <MoveChip key={nodeId} nodeId={nodeId} record={record} quality={quality}
            compact={compact} isCurrent={currentNodeId === nodeId} isTabStop={nodeId === stopNodeId}
            notationStyle={notationStyle}
            onRovingFocus={setRovingNodeId} onKeyDown={handleChipKeyDown} />;
    };

    const pushVariations = (parentId: string, lineIndex: number) => {
        const parent = treeNodes[parentId];
        if (!parent || parent.childrenIds.length <= 1) return;
        const mainChild = activeLineNodeIds[lineIndex + 1] ?? null;
        const variationRoots = parent.childrenIds.filter((childId) => childId !== mainChild);
        variationRoots.forEach((variationRootId) => {
            const { line: variationLine, remaining: variationRemaining } = buildVariationLine(variationRootId, treeNodes);
            const firstRecord = treeNodes[variationRootId]?.record;
            const variationName = firstRecord ? formatMoveLabel(firstRecord, notationStyle) : 'variation';
            rows.push(
                <div key={`var-${parentId}-${variationRootId}`} className="mtree-variation">
                    <IconCornerDownRight className="mtree-var-marker" />
                    {variationLine.map((nodeId) => renderMoveChip(nodeId, true))}
                    {variationRemaining > 0 ? (
                        <span
                            className="mtree-variation-rest"
                            title={`${variationRemaining} more ${variationRemaining === 1 ? 'ply' : 'plies'} in this line — open it to read them`}
                        >
                            +{variationRemaining}
                        </span>
                    ) : null}
                    {onDeleteNode ? (
                        // At the end of the row rather than the start, so it
                        // cannot be mistaken for the first move of the line,
                        // and named after that move so a reader with several
                        // variations open knows which one is going.
                        <button
                            type="button"
                            className="mtree-var-delete"
                            onClick={(event) => {
                                pendingDeleteFocus.current = document.activeElement === event.currentTarget
                                    ? { parentId, element: event.currentTarget } : null;
                                onDeleteNode(variationRootId);
                            }}
                            title={`Delete the variation starting ${variationName}`}
                            aria-label={`Delete the variation starting ${variationName}`}
                            data-testid={`delete-variation-${variationRootId}`}
                        >
                            <IconX aria-hidden="true" focusable="false" />
                        </button>
                    ) : null}
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
                <div className="mtree-pair">
                    {redEntry ? renderMoveChip(redEntry.nodeId) : null}
                    {blackEntry ? renderMoveChip(blackEntry.nodeId) : null}
                </div>
            </div>
        );

        if (lineIndex === 0) pushVariations(rootNodeId, -1);
        if (redEntry) pushVariations(redEntry.nodeId, redEntry.lineIndex);
        if (blackEntry) pushVariations(blackEntry.nodeId, blackEntry.lineIndex);
        lineIndex += consumed;
    }

    return (
        <div
            className="mtree-scroll"
            onClick={handleNavigateClick}
            ref={scrollRef}
            role="group"
            aria-label="Move list, one tab stop; the arrow keys move between moves"
        >
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
                    {hasEstimatedQuality ? <p>Estimates compare separate position scores. Run Review to evaluate the whole line.</p> : null}
                    {hasSavedQualityMarks
                        ? <p>Saved PGN quality marks may use different criteria.</p> : null}
                </div> : null}
        </div>
    );
});

MoveListTree.displayName = 'MoveListTree';

type MoveChipProps = {
    nodeId: string;
    record: NonNullable<MoveTreeNode['record']>;
    quality?: ReviewMoveQuality;
    compact: boolean;
    isCurrent: boolean;
    isTabStop: boolean;
    notationStyle: XiangqiNotationStyle;
    onRovingFocus: (nodeId: string) => void;
    onKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
};

// Records are immutable. Cursor and focus changes only need to redraw the
// affected chips, not rebuild every notation label and annotation in the study.
const MoveChip = memo(function MoveChip({ nodeId, record, quality, compact, isCurrent,
    isTabStop, notationStyle, onRovingFocus, onKeyDown }: MoveChipProps) {
    const qualityClass = getMoveQualityClassName(quality);
    // Coach hint: engine's best alternative (stored on this node from review)
    const coachMove = record.bestMove && record.bestMove !== record.uci ? record.bestMove : null;
    const note = record.quality && isCriticalReviewQuality(record.quality) && record.reviewNote
        ? formatReviewNoteForDisplay(record.reviewNote, record.bestMove)
        : null;
    const isBadMove = record.quality ? isCriticalReviewQuality(record.quality) : qualityClass === 'quality-mistake' || qualityClass === 'quality-blunder';
    // The reader's own note, which is not the review's. Shown under the
    // move like the review note is, so a study reads as a study: a line of
    // fifty moves with three notes on it has to make the three findable.
    const comment = record.comment ? summarizeMoveComment(record.comment) : null;
    return (
        <span className="mtree-chip-wrap">
            {!compact ? <span className="mtree-side" aria-hidden="true">{record.sideToMove === 'b' ? 'Red' : 'Black'}</span> : null}
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
                onFocus={() => onRovingFocus(nodeId)}
                onKeyDown={onKeyDown}
                tabIndex={isTabStop ? 0 : -1}
                title={formatMoveTitle(record, quality)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={formatMoveAriaLabel(record, isCurrent, coachMove, notationStyle, quality)}
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
            >
                {/* One authoritative reading of the move, then the raw
                    coordinates as the cross-reference -- raw, because that
                    is the form you paste into an engine or a share link.
                    In UCI mode the reading already *is* the coordinates, so
                    the second line goes: it was printing `h2e2` under
                    `H2→E2`, which is the same move written twice. */}
                {formatMoveLabel(record, notationStyle)}
                {record.nags?.length ? <span className="mtree-glyphs" aria-hidden="true">
                    {record.nags.slice(0, 3).map(glyphSymbol).join(' ')}{record.nags.length > 3 ? ` +${record.nags.length - 3}` : ''}
                </span> : null}
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
            {comment ? (
                <span className="mtree-comment" title={record.comment}>
                    {comment}
                </span>
            ) : null}
        </span>
    );
});

MoveChip.displayName = 'MoveChip';

function formatMoveLabel(
    record: NonNullable<MoveTreeNode['record']>,
    notationStyle: XiangqiNotationStyle
) {
    // WXF spells the piece out as a letter and Chinese as the same glyph the
    // board draws, so neither needs the glyph repeated in front of it.
    if (notationStyle !== 'uci') return formatMoveNotation(record, notationStyle);
    return formatMoveRecordLabel(record);
}

function qualityDescription(record: NonNullable<MoveTreeNode['record']>, quality?: ReviewMoveQuality): string {
    return quality ? `${record.quality ? 'Move quality' : 'Estimated move quality'} ${formatReviewQuality(quality)}` : '';
}

function formatMoveTitle(record: NonNullable<MoveTreeNode['record']>, quality?: ReviewMoveQuality) {
    // Move quality reaches the eye only as the colour of a 5px dot, and forced
    // colours repaint that dot to its own background -- so the annotation was
    // there with no way at all to read it. The aria-label already carries the
    // quality; give the tooltip the same, which also spares a mouse user from
    // matching a colour against the legend.
    const title = describeMoveWithCheck(record);
    const description = qualityDescription(record, quality);
    return [title, description, describeMoveGlyphs(record.nags)].filter(Boolean).join(' - ');
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
    notationStyle: XiangqiNotationStyle,
    quality?: ReviewMoveQuality
) {
    const notation = formatMoveNotation(record, notationStyle);
    const parts = [
        isCurrent ? 'Current move' : '',
        describeMoveWithCheck(record),
        notationStyle === 'uci' ? '' : notation,
        `UCI ${formatUciMove(record.uci)}`,
        qualityDescription(record, quality),
        describeMoveGlyphs(record.nags),
        coachMove ? `Engine suggestion ${formatAlternative(record, coachMove, notationStyle)}` : '',
        record.comment ? `Note, ${record.comment}` : '',
    ].filter(Boolean);
    return parts.join(', ');
}

/**
 * A variation row, and how much of it did not fit.
 *
 * The row stops at `MAX_VISIBLE_VARIATION_PLIES` so one long side line cannot
 * push the rest of the list off the screen. It used to stop silently, which
 * made a 100-ply line look like a 40-move line that simply ended -- the moves
 * were still there, and still reachable by clicking into the row, but nothing
 * on screen gave a reader any reason to look. The walk now continues past the
 * cap to count what it is not showing, so the row can say so the way the
 * engine's own line strip already does with its `+12`.
 *
 * The `seen` set stays the guard against a cycle; the cap is no longer doing
 * that job on the side.
 */
function buildVariationLine(
    startId: string,
    treeNodes: Record<string, MoveTreeNode>
): { line: string[]; remaining: number } {
    const line: string[] = [];
    let remaining = 0;
    let cursor: string | undefined = startId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (line.length < MAX_VISIBLE_VARIATION_PLIES) line.push(cursor);
        else remaining += 1;
        const children: string[] = treeNodes[cursor]?.childrenIds ?? [];
        const nextNodeId: string | undefined = children[children.length - 1];
        cursor = nextNodeId;
    }
    return { line, remaining };
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
