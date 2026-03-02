import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MoveRecord } from '../../hooks/useXiangqi';

interface EvalGraphProps {
    history: MoveRecord[];
    currentMoveIndex: number;
    currentEval: number;
    isSearching?: boolean;
    branchCounts?: Record<number, number>;
    rootBranchCount?: number;
    onNavigate?: (index: number) => void;
}

type EvalPoint = {
    moveIndex: number;
    eval: number;
    ply: number;
    uci: string | null;
    mover: 'red' | 'black' | 'start';
    branchCount: number;
};

export const EvalGraph = React.memo(function EvalGraph({
    history,
    currentMoveIndex,
    currentEval,
    isSearching = false,
    branchCounts = {},
    rootBranchCount = 0,
    onNavigate
}: EvalGraphProps) {
    const [hoverPointIndex, setHoverPointIndex] = useState<number | null>(null);
    const [viewportWidth, setViewportWidth] = useState(420);
    const viewportRef = useRef<HTMLDivElement | null>(null);

    const points = useMemo<EvalPoint[]>(() => {
        let previous = 0;
        const next: EvalPoint[] = [{
            moveIndex: -1,
            eval: 0,
            ply: 0,
            uci: null,
            mover: 'start',
            branchCount: rootBranchCount,
        }];
        history.forEach((move, index) => {
            if (typeof move.evalScore === 'number') previous = move.evalScore;
            next.push({
                moveIndex: index,
                eval: previous,
                ply: index + 1,
                uci: move.uci,
                mover: index % 2 === 0 ? 'red' : 'black',
                branchCount: branchCounts[index] ?? 0,
            });
        });

        const activePointIndex = Math.max(0, Math.min(next.length - 1, currentMoveIndex + 1));
        const currentMove = currentMoveIndex >= 0 ? history[currentMoveIndex] : undefined;
        const currentPlyHasStoredEval = typeof currentMove?.evalScore === 'number';
        const shouldProjectLiveEval = Number.isFinite(currentEval) && (isSearching || !currentPlyHasStoredEval);
        if (shouldProjectLiveEval) {
            next[activePointIndex] = {
                ...next[activePointIndex],
                eval: currentEval,
            };
        }
        return next;
    }, [history, currentMoveIndex, currentEval, isSearching, branchCounts, rootBranchCount]);

    const maxEvalClamp = 1200;
    const chartHeight = 248;
    const chartWidth = Math.max(320, viewportWidth);
    const padding = { top: 18, right: 20, bottom: 44, left: 42 };
    const plotWidth = chartWidth - padding.left - padding.right;
    const plotHeight = chartHeight - padding.top - padding.bottom;
    const pixelsPerPoint = points.length <= 1 ? plotWidth : plotWidth / (points.length - 1);

    const xFor = (pointIndex: number) => {
        if (points.length <= 1) return padding.left;
        return padding.left + (pointIndex / (points.length - 1)) * plotWidth;
    };
    const yFor = (evalScore: number) => {
        const clamped = Math.max(-maxEvalClamp, Math.min(maxEvalClamp, evalScore));
        return padding.top + ((maxEvalClamp - clamped) / (maxEvalClamp * 2)) * plotHeight;
    };
    const baselineY = yFor(0);

    const linePath = useMemo(() => {
        if (points.length === 0) return '';
        return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(2)} ${yFor(point.eval).toFixed(2)}`).join(' ');
    }, [points, plotWidth, plotHeight]);

    const fillPath = useMemo(() => {
        if (points.length === 0) return '';
        const lastX = xFor(points.length - 1);
        return `${linePath} L ${lastX.toFixed(2)} ${baselineY.toFixed(2)} L ${xFor(0).toFixed(2)} ${baselineY.toFixed(2)} Z`;
    }, [points, linePath, baselineY, plotWidth]);

    const currentPointIndex = Math.max(0, Math.min(points.length - 1, currentMoveIndex + 1));
    const currentPoint = points[currentPointIndex];
    const currentDisplay = formatEval(currentPoint?.eval ?? 0);
    const hoveredPoint = hoverPointIndex == null ? null : points[hoverPointIndex];
    const xTickStep = Math.max(1, Math.ceil(56 / Math.max(1, pixelsPerPoint)));
    const xTickIndexes = useMemo(() => {
        const indexes = new Set<number>([0, currentPointIndex, points.length - 1]);
        for (let index = xTickStep; index < points.length - 1; index += xTickStep) {
            indexes.add(index);
        }
        return Array.from(indexes).sort((left, right) => left - right);
    }, [currentPointIndex, points.length, xTickStep]);
    const highestEval = useMemo(
        () => points.reduce((best, point) => Math.max(best, point.eval), Number.NEGATIVE_INFINITY),
        [points]
    );
    const lowestEval = useMemo(
        () => points.reduce((best, point) => Math.min(best, point.eval), Number.POSITIVE_INFINITY),
        [points]
    );
    const currentBranchCount = currentPoint?.branchCount ?? 0;
    const swing = highestEval - lowestEval;
    const shouldCompressBadges = pixelsPerPoint < 26;

    const nearestPointForEvent = (event: React.MouseEvent<SVGSVGElement>) => {
        if (points.length === 0) return 0;
        const rect = event.currentTarget.getBoundingClientRect();
        const scaleX = chartWidth / rect.width;
        const x = (event.clientX - rect.left) * scaleX;
        let nearest = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        points.forEach((_, pointIndex) => {
            const distance = Math.abs(xFor(pointIndex) - x);
            if (distance < nearestDistance) {
                nearest = pointIndex;
                nearestDistance = distance;
            }
        });
        return nearest;
    };

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;

        const updateWidth = () => {
            setViewportWidth(Math.max(320, Math.floor(element.clientWidth)));
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
        onNavigate(targetIndex);
    };

    const tooltipPoint = hoveredPoint ?? currentPoint;
    const tooltipIndex = hoveredPoint ? hoverPointIndex ?? currentPointIndex : currentPointIndex;
    const tooltipBranchCount = tooltipPoint?.branchCount ?? 0;
    const tooltipX = Math.max(padding.left + 54, Math.min(chartWidth - padding.right - 54, xFor(tooltipIndex)));
    const tooltipY = Math.max(54, yFor(tooltipPoint?.eval ?? 0) - 18);

    return (
        <div className="graph-wrap">
            <div className="graph-summary">
                <div className="graph-summary-card">
                    <span>State</span>
                    <strong>{isSearching ? 'Live Search' : 'Pinned Node'}</strong>
                </div>
                <div className="graph-summary-card">
                    <span>Current</span>
                    <strong>{currentDisplay}</strong>
                </div>
                <div className="graph-summary-card">
                    <span>Swing</span>
                    <strong>{formatEval(swing)}</strong>
                </div>
                <div className="graph-summary-card">
                    <span>Branches</span>
                    <strong>{currentBranchCount > 1 ? `${currentBranchCount} lines` : 'Main line'}</strong>
                </div>
            </div>
            <div className="graph-scroll" ref={viewportRef}>
                <div className="graph-scroll-inner">
                    <svg
                        className="winrate-graph"
                        width={chartWidth}
                        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                        onClick={onChartClick}
                        onMouseMove={(event) => setHoverPointIndex(nearestPointForEvent(event))}
                        onMouseLeave={() => setHoverPointIndex(null)}
                        onFocus={() => setHoverPointIndex(currentPointIndex)}
                        onBlur={() => setHoverPointIndex(null)}
                        onKeyDown={onChartKeyDown}
                        style={{ cursor: onNavigate ? 'pointer' : 'default' }}
                        aria-label="Evaluation graph"
                        aria-description="Use left and right arrows to move across the line. Press Enter to jump to the hovered point."
                        role="img"
                        tabIndex={0}
                    >
                        <rect
                            className="graph-zone graph-zone-positive"
                            x={padding.left}
                            y={padding.top}
                            width={plotWidth}
                            height={baselineY - padding.top}
                        />
                        <rect
                            className="graph-zone graph-zone-negative"
                            x={padding.left}
                            y={baselineY}
                            width={plotWidth}
                            height={chartHeight - padding.bottom - baselineY}
                        />
                        {[1000, 500, 0, -500, -1000].map((score) => {
                            const y = yFor(score);
                            return (
                                <g key={`grid-${score}`}>
                                    <line
                                        className={`graph-grid-line ${score === 0 ? 'graph-grid-line-zero' : ''}`}
                                        x1={padding.left}
                                        x2={chartWidth - padding.right}
                                        y1={y}
                                        y2={y}
                                    />
                                    <text className="graph-grid-text" x={padding.left - 8} y={y + 4} textAnchor="end">
                                        {score === 0 ? '0.0' : `${score / 100}`}
                                    </text>
                                </g>
                            );
                        })}
                        {xTickIndexes.map((pointIndex) => {
                            const point = points[pointIndex];
                            const x = xFor(pointIndex);
                            return (
                                <g key={`tick-${pointIndex}`}>
                                    <line
                                        className="graph-axis-tick"
                                        x1={x}
                                        x2={x}
                                        y1={chartHeight - padding.bottom}
                                        y2={chartHeight - padding.bottom + 6}
                                    />
                                    <text className="graph-axis-text" x={x} y={chartHeight - padding.bottom + 18} textAnchor="middle">
                                        {point.moveIndex === -1 ? 'Start' : point.ply}
                                    </text>
                                </g>
                            );
                        })}
                        <defs>
                            <linearGradient id="graph-gradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="rgba(16, 185, 129, 0.35)" />
                                <stop offset="100%" stopColor="rgba(16, 185, 129, 0.03)" />
                            </linearGradient>
                        </defs>
                        <path className="graph-area" d={fillPath} fill="url(#graph-gradient)" />
                        <path className="graph-line" d={linePath} />
                        <line
                            x1={xFor(currentPointIndex)}
                            x2={xFor(currentPointIndex)}
                            y1={padding.top}
                            y2={chartHeight - padding.bottom}
                            className="graph-current-line"
                            strokeWidth="1.5"
                            strokeDasharray="4 4"
                        />
                        {hoverPointIndex != null ? (
                            <line
                                x1={xFor(hoverPointIndex)}
                                x2={xFor(hoverPointIndex)}
                                y1={padding.top}
                                y2={chartHeight - padding.bottom}
                                className="graph-hover-line"
                                strokeWidth="1"
                                strokeDasharray="3 4"
                            />
                        ) : null}
                        {points.map((point, pointIndex) => (
                            <g key={`point-${point.ply}`}>
                                <circle
                                    className={`graph-point ${pointIndex === currentPointIndex ? 'graph-point-active' : ''} ${pointIndex === hoverPointIndex ? 'graph-point-hover' : ''}`}
                                    cx={xFor(pointIndex)}
                                    cy={yFor(point.eval)}
                                    r={pointIndex === currentPointIndex ? 4.4 : pointIndex === hoverPointIndex ? 4 : 2.9}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onNavigate?.(point.moveIndex);
                                    }}
                                />
                                {point.branchCount > 1 && (!shouldCompressBadges || pointIndex === currentPointIndex || pointIndex === hoverPointIndex) ? (
                                    <g
                                        className="graph-branch-badge"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onNavigate?.(point.moveIndex);
                                        }}
                                    >
                                        <rect
                                            x={xFor(pointIndex) + 6}
                                            y={yFor(point.eval) - 19}
                                            width={18}
                                            height={12}
                                            rx={6}
                                        />
                                        <text
                                            x={xFor(pointIndex) + 15}
                                            y={yFor(point.eval) - 10}
                                            textAnchor="middle"
                                        >
                                            {point.branchCount}
                                        </text>
                                    </g>
                                ) : null}
                            </g>
                        ))}
                    </svg>
                    {tooltipPoint ? (
                        <div
                            className="graph-tooltip"
                            style={{
                                left: `${tooltipX}px`,
                                top: `${tooltipY}px`,
                            }}
                        >
                            <strong>{formatPointLabel(tooltipPoint)}</strong>
                            <span>{formatEval(tooltipPoint.eval)}</span>
                            {tooltipBranchCount > 1 ? <em>{tooltipBranchCount} branches</em> : null}
                        </div>
                    ) : null}
                </div>
            </div>
            <div className="graph-legend">
                <span>{currentPoint?.moveIndex === -1 ? 'Start Position' : `${formatPointLabel(currentPoint)} · Ply ${currentPoint?.ply ?? 0}`}</span>
                <strong>{currentDisplay}</strong>
            </div>
            <div className="graph-extrema">
                <span>Peak Red {formatEval(highestEval)}</span>
                <span>Peak Black {formatEval(lowestEval)}</span>
            </div>
        </div>
    );
});

EvalGraph.displayName = 'EvalGraph';

function formatEval(score: number): string {
    const sign = score > 0 ? '+' : '';
    return `${sign}${(score / 100).toFixed(2)}`;
}

function formatPointLabel(point: EvalPoint): string {
    if (point.moveIndex === -1) return 'Start';
    const side = point.mover === 'red' ? 'Red' : 'Black';
    return `${side} ${point.uci?.toUpperCase() ?? ''}`.trim();
}
