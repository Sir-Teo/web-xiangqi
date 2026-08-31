import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MoveRecord } from '../../hooks/useXiangqi';
import {
    formatReviewQuality,
    formatWinPercentLoss,
    formatWinPercentLossLabel,
    getMoveQualityClassName,
    isCriticalReviewQuality,

    isFiniteNumber,} from '../../utils/review';
import { formatUciMove } from '../../utils/moveNotation';
import { boardBeforeRecord, formatMoveInStyle, type XiangqiNotationStyle } from '../../utils/xiangqiNotation';
import {
    describeAnalysisActivity,
    formatAnalysisActivity,
    isAnalysisActivityStalled,
    type AnalysisActivity,
} from '../../utils/analysisActivity';

interface EvalGraphProps {
    history: MoveRecord[];
    currentMoveIndex: number;
    currentEval: number | null;
    isSearching?: boolean;
    activity?: AnalysisActivity;
    notationStyle?: XiangqiNotationStyle;
    branchCounts?: Record<number, number>;
    rootBranchCount?: number;
    loadSweepToken?: number;
    onNavigate?: (index: number) => void;
}

const PADDING = { top: 18, right: 20, bottom: 44, left: 42 } as const;
const MIN_POINT_MARKER_GAP_PX = 7;

type EvalPoint = {
    moveIndex: number;
    eval: number;
    ply: number;
    uci: string | null;
    /** The move written the way the reader asked for it. */
    notation: string | null;
    /** The engine's preference, in the same notation. */
    bestMoveNotation: string | null;
    mover: 'red' | 'black' | 'start';
    branchCount: number;
    quality?: MoveRecord['quality'];
    swing?: MoveRecord['swing'];
    winPercentLoss?: MoveRecord['winPercentLoss'];
    reviewNote?: MoveRecord['reviewNote'];
    bestMove?: MoveRecord['bestMove'];
};

function getMoveRecordMover(move: MoveRecord, index: number): EvalPoint['mover'] {
    if (move.piece) {
        return move.piece === move.piece.toUpperCase() ? 'red' : 'black';
    }
    return index % 2 === 0 ? 'red' : 'black';
}

/**
 * An evaluation the graph can draw.
 *
 * `typeof x === 'number'` admits NaN, and NaN is not survivable here: it
 * reaches `d="... L NaN 12.00 ..."`, where SVG discards the *entire* path, so
 * one bad point erases the whole line rather than one dot. The same value
 * poisons the min/max extent and takes the axis with it, so both halves are one
 * guard or neither.
 *
 * Nothing has been shown to produce a non-finite score. This is the same
 * boundary `clampWinPercentLoss` gives the review path, which is why every
 * accuracy figure downstream is safe without each display re-checking.
 */
const isFiniteEval = isFiniteNumber;

/** Min or max over the finite evaluations, and 0 when there are none. */
function extentOf(points: Array<{ eval: number }>, pick: (a: number, b: number) => number): number {
    let best: number | null = null;
    for (const point of points) {
        if (!isFiniteEval(point.eval)) continue;
        best = best === null ? point.eval : pick(best, point.eval);
    }
    return best ?? 0;
}

export const EvalGraph = React.memo(function EvalGraph({
    history,
    currentMoveIndex,
    currentEval,
    isSearching = false,
    activity = 'idle',
    notationStyle = 'uci',
    branchCounts = {},
    rootBranchCount = 0,
    loadSweepToken = 0,
    onNavigate
}: EvalGraphProps) {
    const [hoverPointIndex, setHoverPointIndex] = useState<number | null>(null);
    const [viewportWidth, setViewportWidth] = useState(420);
    const [shortViewport, setShortViewport] = useState(false);
    const [isSweepingLoad, setIsSweepingLoad] = useState(false);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const sweepTimerRef = useRef<number | null>(null);
    const sweepFrameRef = useRef<number | null>(null);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);

    const points = useMemo<EvalPoint[]>(() => {
        let previous = 0;
        const next: EvalPoint[] = [{
            moveIndex: -1,
            eval: 0,
            ply: 0,
            uci: null,
            notation: null,
            bestMoveNotation: null,
            mover: 'start',
            branchCount: rootBranchCount,
        }];
        history.forEach((move, index) => {
            if (isFiniteEval(move.evalScore)) previous = move.evalScore;
            const before = notationStyle === 'uci' ? null : boardBeforeRecord(move);
            next.push({
                moveIndex: index,
                eval: previous,
                ply: index + 1,
                uci: move.uci,
                notation: before ? formatMoveInStyle(before, move.uci, notationStyle) : formatUciMove(move.uci),
                bestMoveNotation: move.bestMove
                    ? (before ? formatMoveInStyle(before, move.bestMove, notationStyle) : formatUciMove(move.bestMove))
                    : null,
                mover: getMoveRecordMover(move, index),
                branchCount: branchCounts[index] ?? 0,
                quality: move.quality,
                swing: move.swing,
                winPercentLoss: move.winPercentLoss,
                reviewNote: move.reviewNote,
                bestMove: move.bestMove,
            });
        });

        const activePointIndex = Math.max(0, Math.min(next.length - 1, currentMoveIndex + 1));
        const currentMove = currentMoveIndex >= 0 ? history[currentMoveIndex] : undefined;
        const currentPlyHasStoredEval = isFiniteEval(currentMove?.evalScore);
        const shouldProjectLiveEval = isFiniteEval(currentEval) && (isSearching || !currentPlyHasStoredEval);
        if (shouldProjectLiveEval) {
            next[activePointIndex] = {
                ...next[activePointIndex],
                eval: currentEval,
            };
        }
        return next;
    }, [history, currentMoveIndex, currentEval, isSearching, branchCounts, rootBranchCount, notationStyle]);

    const maxEvalClamp = 1200;
    const chartHeight = shortViewport ? 184 : 248;
    // Floor low enough that the SVG viewBox matches the rendered width for any
    // realistic panel size. A 320 floor letterboxed the chart (default panel is
    // 277px of stage) and put the overlay tooltip in a different coordinate
    // space than the points it labels.
    const chartWidth = Math.max(200, viewportWidth);
    const plotWidth = chartWidth - PADDING.left - PADDING.right;
    const plotHeight = chartHeight - PADDING.top - PADDING.bottom;
    const pixelsPerPoint = points.length <= 1 ? plotWidth : plotWidth / (points.length - 1);

    const xFor = useCallback((pointIndex: number) => {
        if (points.length <= 1) return PADDING.left;
        return PADDING.left + (pointIndex / (points.length - 1)) * plotWidth;
    }, [points.length, plotWidth]);

    const yFor = useCallback((evalScore: number) => {
        // Math.max(-limit, Math.min(limit, NaN)) is NaN, so the clamp does not
        // strip a bad value -- it carries it into the path and takes out the
        // whole line.
        const finite = isFiniteEval(evalScore) ? evalScore : 0;
        const clamped = Math.max(-maxEvalClamp, Math.min(maxEvalClamp, finite));
        return PADDING.top + ((maxEvalClamp - clamped) / (maxEvalClamp * 2)) * plotHeight;
    }, [maxEvalClamp, plotHeight]);

    const baselineY = yFor(0);

    // Pre-compute {x, y} for each point once — reused in paths, dots, and badges
    const computedPoints = useMemo(
        () => points.map((p, i) => ({ ...p, x: xFor(i), y: yFor(p.eval) })),
        [points, xFor, yFor]
    );

    const linePath = useMemo(() => {
        if (computedPoints.length === 0) return '';
        return computedPoints.map((pt, index) => `${index === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ');
    }, [computedPoints]);

    const fillPath = useMemo(() => {
        if (computedPoints.length === 0) return '';
        const lastX = computedPoints[computedPoints.length - 1].x;
        return `${linePath} L ${lastX.toFixed(2)} ${baselineY.toFixed(2)} L ${computedPoints[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
    }, [computedPoints, linePath, baselineY]);

    // points[0] is the start position, so a move index maps one slot to its right.
    const pointIndexForMove = (moveIndex: number) => Math.max(0, Math.min(points.length - 1, moveIndex + 1));
    const currentPointIndex = pointIndexForMove(currentMoveIndex);
    const currentPoint = points[currentPointIndex];
    const currentPerspectiveDisplay = formatRedPovEval(currentPoint?.eval ?? 0);
    const currentValueText = currentPoint ? formatGraphValueText(currentPoint) : 'No moves';
    const hoveredPoint = hoverPointIndex == null ? null : points[hoverPointIndex];
    const pointRenderStep = pixelsPerPoint >= MIN_POINT_MARKER_GAP_PX
        ? 1
        : Math.max(1, Math.ceil(MIN_POINT_MARKER_GAP_PX / Math.max(0.01, pixelsPerPoint)));
    const visiblePointIndexes = useMemo(() => {
        const indexes = new Set<number>([0, currentPointIndex, points.length - 1]);

        computedPoints.forEach((pt, pointIndex) => {
            const mustRender =
                pointIndex === currentPointIndex ||
                pointIndex === hoverPointIndex ||
                pointIndex % pointRenderStep === 0 ||
                pt.branchCount > 1 ||
                Boolean(pt.quality && isCriticalReviewQuality(pt.quality));
            if (mustRender) indexes.add(pointIndex);
        });

        return Array.from(indexes).sort((left, right) => left - right);
    }, [computedPoints, currentPointIndex, hoverPointIndex, pointRenderStep, points.length]);
    const xTickStep = Math.max(1, Math.ceil(56 / Math.max(1, pixelsPerPoint)));
    const xTickIndexes = useMemo(() => {
        const indexes = new Set<number>([0, currentPointIndex, points.length - 1]);
        for (let index = xTickStep; index < points.length - 1; index += xTickStep) {
            indexes.add(index);
        }
        return Array.from(indexes).sort((left, right) => left - right);
    }, [currentPointIndex, points.length, xTickStep]);
    const highestEval = useMemo(() => extentOf(points, Math.max), [points]);
    const lowestEval = useMemo(() => extentOf(points, Math.min), [points]);
    const currentBranchCount = currentPoint?.branchCount ?? 0;
    const swing = highestEval - lowestEval;
    const shouldCompressBadges = pixelsPerPoint < 26;

    const nearestPointForEvent = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
        if (computedPoints.length === 0) return 0;
        const rect = event.currentTarget.getBoundingClientRect();
        const scaleX = chartWidth / rect.width;
        const x = (event.clientX - rect.left) * scaleX;
        // Binary search — computedPoints are ordered by ascending x
        let lo = 0;
        let hi = computedPoints.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (computedPoints[mid].x < x) lo = mid + 1;
            else hi = mid;
        }
        // Check lo and lo-1 for the nearest
        if (lo > 0 && Math.abs(computedPoints[lo - 1].x - x) <= Math.abs(computedPoints[lo].x - x)) {
            return lo - 1;
        }
        return lo;
    }, [computedPoints, chartWidth]);

    // The eval column stacks summary cards, the chart, a legend and the peak row
    // above the opening book. Below roughly 820px of viewport height it stops
    // fitting and the book continuations are pushed under the fold; give the
    // chart back that height instead of the book losing rows.
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia('(max-height: 820px)');
        const apply = () => setShortViewport(mq.matches);
        apply();
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    }, []);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;

        const updateWidth = () => {
            setViewportWidth(Math.max(200, Math.floor(element.clientWidth)));
        };

        updateWidth();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateWidth);
            return () => window.removeEventListener('resize', updateWidth);
        }

        const observer = new ResizeObserver(() => updateWidth());
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (loadSweepToken <= 0 || points.length <= 1 || typeof window === 'undefined') {
            return;
        }

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setIsSweepingLoad(false);
            return;
        }

        if (sweepTimerRef.current != null) {
            window.clearTimeout(sweepTimerRef.current);
        }
        if (sweepFrameRef.current != null) {
            window.cancelAnimationFrame(sweepFrameRef.current);
        }

        setIsSweepingLoad(false);
        sweepFrameRef.current = window.requestAnimationFrame(() => {
            setIsSweepingLoad(true);
            sweepTimerRef.current = window.setTimeout(() => {
                setIsSweepingLoad(false);
                sweepTimerRef.current = null;
            }, 650);
        });

        return () => {
            if (sweepTimerRef.current != null) {
                window.clearTimeout(sweepTimerRef.current);
                sweepTimerRef.current = null;
            }
            if (sweepFrameRef.current != null) {
                window.cancelAnimationFrame(sweepFrameRef.current);
                sweepFrameRef.current = null;
            }
        };
    }, [loadSweepToken, points.length]);

    const onChartClick = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!onNavigate || points.length === 0) return;
        const nearest = nearestPointForEvent(event);
        onNavigate(points[nearest].moveIndex);
    };

    const onChartKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
        if (!onNavigate) return;

        if (event.key === 'Enter' || event.key === ' ') {
            if (hoverPointIndex != null) {
                event.preventDefault();
                onNavigate(points[hoverPointIndex].moveIndex);
            }
            return;
        }

        let targetIndex: number | null = null;
        switch (event.key) {
            case 'ArrowLeft':
            case 'PageUp':
                targetIndex = Math.max(-1, currentMoveIndex - 1);
                break;
            case 'ArrowRight':
            case 'PageDown':
                targetIndex = Math.min(history.length - 1, currentMoveIndex + 1);
                break;
            case 'Home':
                targetIndex = -1;
                break;
            case 'End':
                targetIndex = history.length - 1;
                break;
            default:
                break;
        }

        if (targetIndex == null) return;
        event.preventDefault();
        event.stopPropagation();
        setHoverPointIndex(pointIndexForMove(targetIndex));
        onNavigate(targetIndex);
    };

    const onTouchStart = (event: React.TouchEvent<SVGSVGElement>) => {
        const t = event.touches[0];
        touchStartRef.current = { x: t.clientX, y: t.clientY };
    };

    const onTouchEnd = (event: React.TouchEvent<SVGSVGElement>) => {
        if (!onNavigate || !touchStartRef.current) return;
        const t = event.changedTouches[0];
        const dx = t.clientX - touchStartRef.current.x;
        const dy = Math.abs(t.clientY - touchStartRef.current.y);
        touchStartRef.current = null;
        if (Math.abs(dx) < 30 || dy > 60) return;
        const delta = dx < 0 ? 1 : -1;
        const target = Math.max(-1, Math.min(history.length - 1, currentMoveIndex + delta));
        onNavigate(target);
    };

    const tooltipRef = useRef<HTMLDivElement>(null);
    const [tooltipSize, setTooltipSize] = useState({ width: 150, height: 52 });
    const tooltipPoint = hoveredPoint ?? currentPoint;
    const tooltipIndex = hoveredPoint ? hoverPointIndex ?? currentPointIndex : currentPointIndex;
    const tooltipBranchCount = tooltipPoint?.branchCount ?? 0;
    const tooltipQualityClass = tooltipPoint?.quality ? getMoveQualityClassName(tooltipPoint.quality) : '';

    // A review note can make the tooltip several times taller than a bare
    // eval readout, so clamp against its measured box rather than a guessed
    // half-width, and flip it under the point when it will not fit above.
    const anchorX = computedPoints[tooltipIndex]?.x ?? xFor(tooltipIndex);
    const anchorY = computedPoints[tooltipIndex]?.y ?? yFor(tooltipPoint?.eval ?? 0);
    const halfTooltipWidth = tooltipSize.width / 2;
    // The y-axis labels are drawn with textAnchor="end" at PADDING.left - 8, so
    // that x is their right edge. Clamping the tooltip to the chart edge instead
    // parked it on top of them whenever the anchor was the first point -- which
    // is the default state, before a single move is played.
    const gutterRight = PADDING.left - 8;
    const minTooltipX = gutterRight + halfTooltipWidth;
    const maxTooltipX = chartWidth - halfTooltipWidth - 4;
    // If the box still cannot fit the track, park it against the gutter rather
    // than centring it: centring pushed it back over the very labels this
    // clamp exists to keep clear.
    const tooltipX = minTooltipX <= maxTooltipX
        ? Math.min(Math.max(anchorX, minTooltipX), maxTooltipX)
        : minTooltipX;
    const tooltipBelow = anchorY - tooltipSize.height - 14 < 4;
    const tooltipY = tooltipBelow
        ? Math.min(anchorY + 14, Math.max(4, chartHeight - tooltipSize.height - 4))
        : Math.max(tooltipSize.height + 4, anchorY - 14);

    useLayoutEffect(() => {
        const element = tooltipRef.current;
        if (!element) return;
        const { width, height } = element.getBoundingClientRect();
        setTooltipSize(previous => (
            Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
                ? previous
                : { width, height }
        ));
        // Re-measure only when the content or the available width changes; the
        // equality guard above keeps a same-size render from looping.
    }, [tooltipPoint, chartWidth]);

    return (
        <div className="graph-wrap">
            <div className="graph-summary">
                {/* Play mode runs without the engine, and a backgrounded tab
                    stops searching -- "Idle" would read as a ready engine
                    reporting an even position in both cases. The pause is the
                    one that needs saying out loud, because nothing else on
                    screen changes and it does not clear itself. */}
                <div
                    className={`graph-summary-card${isAnalysisActivityStalled(activity) ? ' graph-summary-card-stalled' : ''}`}
                    title={describeAnalysisActivity(activity)}
                >
                    <span>State</span>
                    <strong>{formatAnalysisActivity(activity)}</strong>
                    {isAnalysisActivityStalled(activity) ? (
                        <em className="graph-summary-hint">Tab in background</em>
                    ) : null}
                </div>
                <div className="graph-summary-card">
                    <span>Current</span>
                    <strong>{currentPerspectiveDisplay}</strong>
                </div>
                <div className="graph-summary-card">
                    <span>Swing</span>
                    <strong>{formatEval(swing)}</strong>
                </div>
                <div className="graph-summary-card">
                    <span>Branches</span>
                    {/* This counts the continuations leaving the current move. Saying
                        "Main line" for one of them answered a different question from
                        the one the label asks, and read as a claim about where you
                        are -- it said main line while you stood on a variation. */}
                    <strong>{currentBranchCount > 1 ? `${currentBranchCount} lines` : 'None'}</strong>
                </div>
            </div>
            <div className="graph-scroll" ref={viewportRef}>
                <div className="graph-scroll-inner">
                    <div className={`graph-svg-stage ${isSweepingLoad ? 'graph-svg-stage-sweeping' : ''}`}>
                        <p id="evaluation-graph-instructions" className="sr-only">
                            Use left and right arrows to move across the line. Press Home or End to jump to the edge of the line.
                        </p>
                        <svg
                            className="winrate-graph"
                            width={chartWidth}
                            height={chartHeight}
                            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                            onClick={onChartClick}
                            onMouseMove={(event) => setHoverPointIndex(nearestPointForEvent(event))}
                            onMouseLeave={() => setHoverPointIndex(null)}
                            onFocus={() => setHoverPointIndex(currentPointIndex)}
                            onBlur={() => setHoverPointIndex(null)}
                            onKeyDown={onChartKeyDown}
                            onTouchStart={onTouchStart}
                            onTouchEnd={onTouchEnd}
                            style={{ cursor: onNavigate ? 'pointer' : 'default' }}
                            aria-label="Evaluation graph move navigator"
                            aria-describedby="evaluation-graph-instructions"
                            role="slider"
                            aria-orientation="horizontal"
                            aria-valuemin={0}
                            aria-valuemax={Math.max(0, points.length - 1)}
                            aria-valuenow={currentPointIndex}
                            aria-valuetext={currentValueText}
                            aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End Enter Space"
                            data-rendered-points={visiblePointIndexes.length}
                            data-total-points={points.length}
                            tabIndex={0}
                        >
                            <defs>
                                <linearGradient id="graph-gradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="rgba(16, 185, 129, 0.35)" />
                                    <stop offset="100%" stopColor="rgba(16, 185, 129, 0.03)" />
                                </linearGradient>
                            </defs>
                            <g aria-hidden="true" focusable="false">
                                <rect
                                    className="graph-zone graph-zone-positive"
                                    x={PADDING.left}
                                    y={PADDING.top}
                                    width={plotWidth}
                                    height={baselineY - PADDING.top}
                                />
                                <rect
                                    className="graph-zone graph-zone-negative"
                                    x={PADDING.left}
                                    y={baselineY}
                                    width={plotWidth}
                                    height={chartHeight - PADDING.bottom - baselineY}
                                />
                                {[1000, 500, 0, -500, -1000].map((score) => {
                                    const y = yFor(score);
                                    return (
                                        <g key={`grid-${score}`}>
                                            <line
                                                className={`graph-grid-line ${score === 0 ? 'graph-grid-line-zero' : ''}`}
                                                x1={PADDING.left}
                                                x2={chartWidth - PADDING.right}
                                                y1={y}
                                                y2={y}
                                            />
                                            <text className="graph-grid-text" x={PADDING.left - 8} y={y + 4} textAnchor="end">
                                                {score === 0 ? '=' : score > 0 ? `R+${score / 100}` : `B+${Math.abs(score) / 100}`}
                                            </text>
                                        </g>
                                    );
                                })}
                                {xTickIndexes.map((pointIndex) => {
                                    const pt = computedPoints[pointIndex];
                                    return (
                                        <g key={`tick-${pointIndex}`}>
                                            <line
                                                className="graph-axis-tick"
                                                x1={pt.x}
                                                x2={pt.x}
                                                y1={chartHeight - PADDING.bottom}
                                                y2={chartHeight - PADDING.bottom + 6}
                                            />
                                            <text className="graph-axis-text" x={pt.x} y={chartHeight - PADDING.bottom + 18} textAnchor="middle">
                                                {pt.moveIndex === -1 ? 'Start' : pt.ply}
                                            </text>
                                        </g>
                                    );
                                })}
                                <path className="graph-area" d={fillPath} fill="url(#graph-gradient)" />
                                <path className="graph-line" d={linePath} />
                                <line
                                    x1={computedPoints[currentPointIndex]?.x ?? 0}
                                    x2={computedPoints[currentPointIndex]?.x ?? 0}
                                    y1={PADDING.top}
                                    y2={chartHeight - PADDING.bottom}
                                    className="graph-current-line"
                                    strokeWidth="1.5"
                                    strokeDasharray="4 4"
                                />
                                {hoverPointIndex != null ? (
                                    <line
                                        x1={computedPoints[hoverPointIndex]?.x ?? 0}
                                        x2={computedPoints[hoverPointIndex]?.x ?? 0}
                                        y1={PADDING.top}
                                        y2={chartHeight - PADDING.bottom}
                                        className="graph-hover-line"
                                        strokeWidth="1"
                                        strokeDasharray="3 4"
                                    />
                                ) : null}
                                {visiblePointIndexes.map((pointIndex) => {
                                    const pt = computedPoints[pointIndex];
                                    return (
                                        <g key={`point-${pointIndex}-${pt.ply}`}>
                                            {pt.quality && isCriticalReviewQuality(pt.quality) ? (
                                                <circle
                                                    className={`graph-review-marker ${getMoveQualityClassName(pt.quality)}`}
                                                    cx={pt.x}
                                                    cy={pt.y}
                                                    r={6.4}
                                                />
                                            ) : null}
                                            <circle
                                                className={`graph-point ${pointIndex === currentPointIndex ? 'graph-point-active' : ''} ${pointIndex === hoverPointIndex ? 'graph-point-hover' : ''}`}
                                                cx={pt.x}
                                                cy={pt.y}
                                                r={pointIndex === currentPointIndex ? 4.4 : pointIndex === hoverPointIndex ? 4 : 2.9}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onNavigate?.(pt.moveIndex);
                                                }}
                                            />
                                            {pt.branchCount > 1 && (!shouldCompressBadges || pointIndex === currentPointIndex || pointIndex === hoverPointIndex) ? (
                                                <g
                                                    className="graph-branch-badge"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onNavigate?.(pt.moveIndex);
                                                    }}
                                                >
                                                    <rect
                                                        x={pt.x + 6}
                                                        y={pt.y - 19}
                                                        width={18}
                                                        height={12}
                                                        rx={6}
                                                    />
                                                    <text
                                                        x={pt.x + 15}
                                                        y={pt.y - 10}
                                                        textAnchor="middle"
                                                    >
                                                        {pt.branchCount}
                                                    </text>
                                                </g>
                                            ) : null}
                                        </g>
                                    );
                                })}
                            </g>
                        </svg>
                        {isSweepingLoad ? <div className="graph-load-sweep-overlay" aria-hidden="true" data-testid="graph-load-sweep" /> : null}
                    </div>
                    {tooltipPoint ? (
                        <div
                            ref={tooltipRef}
                            className={`graph-tooltip${tooltipBelow ? ' graph-tooltip-below' : ''}`}
                            style={{
                                left: `${tooltipX}px`,
                                top: `${tooltipY}px`,
                            }}
                        >
                            <strong>{formatPointLabel(tooltipPoint)}</strong>
                            <span>{formatRedPovEval(tooltipPoint.eval)}</span>
                            {tooltipPoint?.quality ? (
                                <em className={`graph-tooltip-quality ${tooltipQualityClass}`}>
                                    {formatReviewQuality(tooltipPoint.quality)}
                                    {typeof tooltipPoint.swing === 'number' ? ` · ${Math.round(tooltipPoint.swing)}cp` : ''}
                                </em>
                            ) : null}
                            {typeof tooltipPoint?.winPercentLoss === 'number' && tooltipPoint.mover !== 'start' ? (
                                <em
                                    className="graph-tooltip-chance"
                                    aria-label={formatWinPercentLossLabel(tooltipPoint.winPercentLoss, tooltipPoint.mover)}
                                >
                                    Chance {formatWinPercentLoss(tooltipPoint.winPercentLoss)}
                                </em>
                            ) : null}
                            {tooltipPoint?.reviewNote ? <span>{tooltipPoint.reviewNote}</span> : null}
                            {tooltipPoint?.bestMove && tooltipPoint.bestMove !== tooltipPoint.uci ? (
                                <em>Engine: {tooltipPoint.bestMoveNotation ?? formatUciMove(tooltipPoint.bestMove)}</em>
                            ) : null}
                            {tooltipBranchCount > 1 ? <em>{tooltipBranchCount} branches</em> : null}
                        </div>
                    ) : null}
                </div>
            </div>
            <div className="graph-legend">
                <span data-testid="graph-current-point">{currentPoint?.moveIndex === -1 ? 'Start Position' : `${formatPointLabel(currentPoint)} · Ply ${currentPoint?.ply ?? 0}`}</span>
                <strong>{currentPerspectiveDisplay}</strong>
            </div>
            <div className="graph-extrema">
                <span>Peak Red {formatEval(highestEval)}</span>
                <span>Peak Black {formatEval(-lowestEval)}</span>
            </div>
        </div>
    );
});

EvalGraph.displayName = 'EvalGraph';

function formatEval(score: number): string {
    const sign = score > 0 ? '+' : '';
    return `${sign}${(score / 100).toFixed(2)}`;
}

function formatRedPovEval(score: number): string {
    return `Red POV ${formatEval(score)}`;
}

function formatPointLabel(point: EvalPoint): string {
    if (point.moveIndex === -1) return 'Start';
    const side = point.mover === 'red' ? 'Red' : 'Black';
    const move = point.notation ?? (point.uci ? formatUciMove(point.uci) : '');
    return `${side} ${move}`.trim();
}

function formatGraphValueText(point: EvalPoint): string {
    const parts = [
        point.moveIndex === -1 ? 'Start position' : `${formatPointLabel(point)}, ply ${point.ply}`,
        `Red POV evaluation ${formatEval(point.eval)}`,
        point.quality ? formatReviewQuality(point.quality) : '',
        typeof point.winPercentLoss === 'number' && point.mover !== 'start'
            ? formatWinPercentLossLabel(point.winPercentLoss, point.mover)
            : '',
        point.bestMove && point.bestMove !== point.uci
            ? `engine suggests ${point.bestMoveNotation ?? formatUciMove(point.bestMove)}`
            : '',
        point.branchCount > 1 ? `${point.branchCount} branches` : '',
    ].filter(Boolean);
    return parts.join(', ');
}
