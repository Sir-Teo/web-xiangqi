import { useVirtualRows } from '../../hooks/useVirtualRows';
import { buildMoveListNavigation, buildMoveListRows, type MoveListRow } from '../../utils/moveListRows';
import { isComposingKey } from '../../utils/keyboard';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MoveTreeNode, MoveTreeStructure } from '../../hooks/useXiangqi';
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
import { verticalRovingIndexForKey } from '../../utils/rovingFocus';
import { describeMoveWithCheck, formatMoveRecordLabel, formatUciMove } from '../../utils/moveNotation';
import { summarizeMoveComment } from '../../utils/moveComment';
import { describeMoveGlyphs, glyphSymbol } from '../../utils/moveGlyphs';
import {
    boardBeforeRecord,
    formatMoveInStyle,
    formatRecordInStyle,
    type XiangqiNotationStyle,
} from '../../utils/xiangqiNotation';
import { IconSpark, IconCornerDownRight, IconX } from '../icons';

type Props = {
    treeNodes: Record<string, MoveTreeNode>;
    moveStructure: MoveTreeStructure;
    rootNodeId: string;
    rootFen: string;
    currentNodeId: string;
    activeLineNodeIds: string[];
    notationStyle?: XiangqiNotationStyle;
    onNavigateNode: (nodeId: string) => void;
    /** Offered on each variation row; the main line is never deletable from here. */
    onDeleteNode?: (nodeId: string) => void;
    onShowBoard?: () => void;
    onOpenLibrary?: () => void;
};

export const MoveListTree = memo(function MoveListTree({
    treeNodes,
    moveStructure,
    rootNodeId,
    rootFen,
    currentNodeId,
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
    const rows = useMemo(() => buildMoveListRows(moveStructure, rootNodeId, activeLineNodeIds, rootFen),
        [moveStructure, rootNodeId, activeLineNodeIds, rootFen]);
    const keys = useMemo(() => rows.map(row => row.key), [rows]);
    const navigation = useMemo(() => buildMoveListNavigation(rows, moveStructure), [rows, moveStructure]);
    const stopNodeId = rovingNodeId && navigation.rowByNode.has(rovingNodeId)
        ? rovingNodeId : navigation.rowByNode.has(currentNodeId) ? currentNodeId : navigation.ids[0] ?? null;
    // The root has no chip, but returning to it must reveal the first rows
    // and root variations rather than leave a virtual list at its old cursor.
    const activeRow = currentNodeId === rootNodeId ? 0 : navigation.rowByNode.get(currentNodeId) ?? -1;
    const stopRow = navigation.rowByNode.get(stopNodeId ?? '') ?? -1;
    const retainedRows = useMemo(() => [activeRow, stopRow], [activeRow, stopRow]);
    const virtual = useVirtualRows(keys, scrollRef, activeRow, retainedRows);
    const visibleSignature = virtual.indices.join(',');
    const virtualOffsets = virtual.offsets;
    const cancelAutomaticScroll = virtual.stopAutomaticScroll;
    const pendingFocus = useRef<{ id: string; row: number; x?: number; direction?: number } | null>(null);
    const automaticScroll = useRef(true);
    const lastPosition = useRef(currentNodeId);
    const live = useRef({ navigation, rows, virtual });
    live.current = { navigation, rows, virtual };
    const requestFocus = useCallback((id: string, x?: number, direction?: number) => {
        const row = live.current.navigation.rowByNode.get(id);
        if (row === undefined) return;
        pendingFocus.current = { id, row, x, direction };
        automaticScroll.current = false;
        setRovingNodeId(id);
        live.current.virtual.scrollToIndex(row);
    }, []);
    const handleChipKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
        const key = event.key;
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
        event.preventDefault();
        const { navigation, rows } = live.current;
        const id = event.currentTarget.dataset.nodeId!;
        const index = navigation.ids.indexOf(id);
        if (index < 0) return;
        if (key === 'Home') { requestFocus(navigation.ids[0]); return; }
        if (key === 'End') { requestFocus(navigation.ids[navigation.ids.length - 1]); return; }
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            requestFocus(navigation.ids[Math.max(0, Math.min(navigation.ids.length - 1, index + (key === 'ArrowLeft' ? -1 : 1)))]); return;
        }
        const chips = Array.from(scrollRef.current?.querySelectorAll<HTMLButtonElement>('.mtree-chip') ?? []);
        const mountedIndex = chips.indexOf(event.currentTarget);
        const targetIndex = verticalRovingIndexForKey(key, chips.map(chip => chip.getBoundingClientRect()), mountedIndex);
        const geometric = targetIndex === null ? undefined : chips[targetIndex];
        const row = navigation.rowByNode.get(id)!;
        const targetRow = geometric ? navigation.rowByNode.get(geometric.dataset.nodeId!)! : row;
        if (geometric && Math.abs(targetRow - row) <= 1 && geometric !== event.currentTarget) {
            requestFocus(geometric.dataset.nodeId!); return;
        }
        const direction = key === 'ArrowUp' ? -1 : 1;
        const nextRow = Math.max(0, Math.min(rows.length - 1, row + direction));
        if (nextRow === row) return;
        const next = rows[nextRow].nodeIds.find(id => navigation.rowByNode.has(id));
        const box = event.currentTarget.getBoundingClientRect();
        if (next) requestFocus(next, box.left + box.width / 2, direction);
    }, [requestFocus]);
    useLayoutEffect(() => {
        const pending = pendingFocus.current;
        if (pending) {
            const container = scrollRef.current;
            const row = container?.querySelector<HTMLElement>(`[data-virtual-index="${pending.row}"]`);
            const candidates = Array.from(row?.querySelectorAll<HTMLButtonElement>('.mtree-chip') ?? []);
            let target = container?.querySelector<HTMLButtonElement>(`[data-node-id="${pending.id}"]`);
            if (pending.x !== undefined && candidates.length) {
                const edge = pending.direction === -1 ? Math.max(...candidates.map(chip => chip.getBoundingClientRect().top))
                    : Math.min(...candidates.map(chip => chip.getBoundingClientRect().top));
                target = candidates.filter(chip => Math.abs(chip.getBoundingClientRect().top - edge) < 1)
                    .sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.getBoundingClientRect().width / 2 - pending.x!)
                        - Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - pending.x!))[0];
            }
            if (target) {
                pendingFocus.current = null;
                cancelAutomaticScroll();
                target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        }
        if (lastPosition.current !== currentNodeId) { automaticScroll.current = true; lastPosition.current = currentNodeId; }
        const container = scrollRef.current;
        const active = container?.querySelector<HTMLElement>('.mtree-chip-active');
        if (automaticScroll.current && container && active) {
            const box = active.getBoundingClientRect(), viewport = container.getBoundingClientRect();
            if (box.top < viewport.top) container.scrollTop -= viewport.top - box.top;
            else if (box.bottom > viewport.bottom) container.scrollTop += box.bottom - viewport.bottom;
        }
    }, [currentNodeId, rovingNodeId, visibleSignature, virtualOffsets, cancelAutomaticScroll]);
    const stopAutomaticScroll = () => { automaticScroll.current = false; virtual.stopAutomaticScroll(); };
    const legend = useMemo(() => {
        const flags = { quality: false, estimated: false, saved: false };
        for (const id of navigation.ids) {
            const node = treeNodes[id], record = node?.record;
            if (!record || !getMoveListQuality(record, node.parentId ? treeNodes[node.parentId]?.record?.evalScore : undefined)) continue;
            flags.quality = true;
            if (!record.quality) flags.estimated = true;
            if (record.quality && record.persistEvaluation) flags.saved = true;
        }
        return flags;
    }, [navigation, treeNodes]);
    const hasMoveQualityLegend = legend.quality, hasEstimatedQuality = legend.estimated, hasSavedQualityMarks = legend.saved;
    const renderMoveChip = (nodeId: string, compact = false) => {
        const node = treeNodes[nodeId];
        const record = node?.record;
        if (!node || !record) return null;
        const quality = getMoveListQuality(record, node.parentId ? treeNodes[node.parentId]?.record?.evalScore : undefined);
        return <MoveChip key={nodeId} nodeId={nodeId} record={record} quality={quality}
            compact={compact} isCurrent={currentNodeId === nodeId} isTabStop={nodeId === stopNodeId}
            notationStyle={notationStyle}
            onRovingFocus={setRovingNodeId} onKeyDown={handleChipKeyDown} />;
    };

    const renderRow = (row: MoveListRow, index: number) => {
        if (!row.variationRootId) return <div className="mtree-row">
            <span className="mtree-num" data-testid={`move-tree-row-label-${index}`}>{row.label}</span>
            <div className="mtree-pair">{row.nodeIds.map(id => renderMoveChip(id))}</div>
        </div>;
        const firstRecord = treeNodes[row.variationRootId]?.record;
        const variationName = firstRecord ? formatMoveLabel(firstRecord, notationStyle) : 'variation';
        return <div className="mtree-variation">
            <IconCornerDownRight className="mtree-var-marker" />
            {row.nodeIds.map(id => renderMoveChip(id, true))}
            {Boolean(row.remaining) && <span className="mtree-variation-rest" title={`${row.remaining} more ${row.remaining === 1 ? 'ply' : 'plies'} in this line — open it to read them`}>+{row.remaining}</span>}
            {onDeleteNode && <button type="button" className="mtree-var-delete" onClick={event => {
                pendingDeleteFocus.current = document.activeElement === event.currentTarget ? { parentId: row.parentId!, element: event.currentTarget } : null;
                onDeleteNode(row.variationRootId!);
            }} title={`Delete the variation starting ${variationName}`} aria-label={`Delete the variation starting ${variationName}`}
                data-testid={`delete-variation-${row.variationRootId}`}><IconX aria-hidden="true" focusable="false" /></button>}
        </div>;
    };
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

    return (
        <div
            className="mtree-scroll"
            onClick={handleNavigateClick}
            ref={scrollRef}
            onScroll={virtual.onScroll}
            onWheel={stopAutomaticScroll} onPointerDown={stopAutomaticScroll} onTouchStart={stopAutomaticScroll}
            role="group"
            aria-label="Move list, one tab stop; the arrow keys move between moves"
        >
            {virtual.indices.map((index, position) => {
                const previous = virtual.indices[position - 1];
                const gap = virtual.offsets[index] - (previous === undefined ? 0 : virtual.offsets[previous + 1]);
                return <Fragment key={rows[index].key}>
                    {virtual.enabled && gap > 0 && <div aria-hidden="true" style={{ height: gap }} />}
                    <div data-virtual-key={rows[index].key} data-virtual-index={index} style={{ display: 'flow-root' }}>{renderRow(rows[index], index)}</div>
                </Fragment>;
            })}
            {virtual.enabled && <div aria-hidden="true" style={{ height: virtual.offsets[rows.length] - (virtual.offsets[(virtual.indices.at(-1) ?? -1) + 1] ?? 0) }} />}
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
                    : <>{' '}<span className="move-uci">{record.uci}</span></>}
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
    const visibleLabel = notationStyle === 'uci'
        ? formatMoveLabel(record, notationStyle)
        : `${formatMoveNotation(record, notationStyle)} ${record.uci}`;
    const parts = [
        isCurrent ? 'Current move' : '',
        visibleLabel,
        describeMoveWithCheck(record),
        qualityDescription(record, quality),
        describeMoveGlyphs(record.nags),
        coachMove ? `Engine suggestion ${formatAlternative(record, coachMove, notationStyle)}` : '',
        record.comment ? `Note, ${record.comment}` : '',
    ].filter(Boolean);
    return parts.join(', ');
}
