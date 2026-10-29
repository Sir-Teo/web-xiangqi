import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { breadcrumbWindow } from '../../utils/virtualRows';
import type { MoveTreeNode } from '../../hooks/useXiangqi';
import type { XiangqiNotationStyle } from '../../utils/xiangqiNotation';
import { isComposingKey } from '../../utils/keyboard';
import { rovingIndexForKey, rovingTabStopIndex } from '../../utils/rovingFocus';
import { BreadcrumbChip } from './BreadcrumbChip';

type Props = {
  treeNodes: Record<string, MoveTreeNode>;
  rootNodeId: string;
  rootFen: string;
  currentNodeId: string;
  currentMoveIndex: number;
  activeLineNodeIds: string[];
  notationStyle: XiangqiNotationStyle;
  onNavigate: (nodeId: string) => void;
};

/** Keep the long line and its keyboard focus independent of board and editor updates. */
export const TreeBreadcrumb = memo(function TreeBreadcrumb({ treeNodes, rootNodeId, rootFen,
  currentNodeId, currentMoveIndex, activeLineNodeIds, notationStyle, onNavigate }: Props) {
  const treeBreadcrumbRef = useRef<HTMLDivElement>(null);
  const breadcrumbNodeIds = useMemo(() => [rootNodeId, ...activeLineNodeIds.slice(0, currentMoveIndex + 1)], [activeLineNodeIds, currentMoveIndex, rootNodeId]);
  const breadcrumbCount = useRef(breadcrumbNodeIds.length);
  breadcrumbCount.current = breadcrumbNodeIds.length;

  useEffect(() => {
    const container = treeBreadcrumbRef.current;
    const active = container?.querySelector('.tree-breadcrumb-chip-active') as HTMLElement | null;
    if (!container || !active) return;

    const centerActive = (resized = false) => {
      const containerRect = container.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const activeCenter = container.scrollLeft
        + activeRect.left
        - containerRect.left
        + activeRect.width / 2;
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const targetLeft = Math.max(0, Math.min(maxLeft, activeCenter - container.clientWidth / 2));
      const distance = Math.abs(targetLeft - container.scrollLeft);
      const activeFullyVisible = activeRect.left >= containerRect.left && activeRect.right <= containerRect.right;
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior: ScrollBehavior = resized || prefersReducedMotion || !activeFullyVisible || distance > container.clientWidth
        ? 'auto'
        : 'smooth';
      if (distance > 1) container.scrollTo({ left: targetLeft, behavior });
    };
    centerActive();
    // Reopening initially sees a collapsed panel width. Recenter as it grows,
    // and when enlarged text changes the active chip's dimensions.
    const observer = new ResizeObserver(() => centerActive(true));
    observer.observe(container);
    observer.observe(active);
    return () => observer.disconnect();
  }, [breadcrumbNodeIds.length, currentNodeId]);

  const [rovingBreadcrumbIndex, setRovingBreadcrumbIndex] = useState<number | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const breadcrumbCurrentIndex = breadcrumbNodeIds.indexOf(currentNodeId);
  const breadcrumbTabStopIndex = rovingTabStopIndex(
    breadcrumbNodeIds.length,
    rovingBreadcrumbIndex,
    breadcrumbCurrentIndex >= 0 ? breadcrumbCurrentIndex : null
  );
  const visible = breadcrumbWindow(breadcrumbNodeIds.length, breadcrumbTabStopIndex ?? 0);
  const focusIndex = useCallback((index: number) => {
    pendingFocus.current = index;
    setRovingBreadcrumbIndex(index);
  }, []);
  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    const target = treeBreadcrumbRef.current?.querySelector<HTMLButtonElement>(`[data-breadcrumb-index="${index}"]`);
    if (target) { pendingFocus.current = null; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }, [rovingBreadcrumbIndex, breadcrumbNodeIds.length]);

  const handleBreadcrumbKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
    const next = rovingIndexForKey(event.key, breadcrumbCount.current, index);
    if (next === null) return;
    event.preventDefault();
    focusIndex(next);
  }, [focusIndex]);

  return (
    <div
      className="tree-breadcrumb"
      ref={treeBreadcrumbRef}
      role="toolbar"
      aria-label="Current line, one chip per move"
      aria-orientation="horizontal"
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      onClick={event => {
        const chip = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('.tree-breadcrumb-chip') : null;
        const nodeId = chip?.dataset.breadcrumbNodeId;
        if (chip && nodeId && event.currentTarget.contains(chip)) onNavigate(nodeId);
      }}
    >
      {visible.map((index, position) => {
        const nodeId = breadcrumbNodeIds[index];
        const previous = visible[position - 1];
        const hidden = previous === undefined ? 0 : index - previous - 1;
        return <Fragment key={nodeId}>
          {hidden > 0 && <button type="button" className="tree-breadcrumb-gap" tabIndex={-1}
            aria-label={`Show ${hidden} earlier moves`} onClick={() => focusIndex(index === breadcrumbNodeIds.length - 1 ? previous! + 1 : index - 1)}>… {hidden}</button>}
          <BreadcrumbChip nodeId={nodeId} index={index}
          record={treeNodes[nodeId]?.record} rootFen={rootFen} notationStyle={notationStyle}
          isRoot={nodeId === rootNodeId} isCurrent={nodeId === currentNodeId}
          isTabStop={index === breadcrumbTabStopIndex} hasNext={index < breadcrumbNodeIds.length - 1}
          onFocusIndex={setRovingBreadcrumbIndex}
          onKeyDown={handleBreadcrumbKeyDown} />
        </Fragment>;
      })}
    </div>
  );
});

TreeBreadcrumb.displayName = 'TreeBreadcrumb';
