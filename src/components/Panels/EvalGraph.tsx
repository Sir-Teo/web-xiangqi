import React, { useMemo, useState } from 'react';
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

    const points = useMemo<EvalPoint[]>(() => {
        let previous = 0;
        const next: EvalPoint[] = [{ moveIndex: -1, eval: 0, ply: 0 }];
        history.forEach((move, index) => {
            if (typeof move.evalScore === 'number') previous = move.evalScore;
            next.push({ moveIndex: index, eval: previous, ply: index + 1 });
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
    }, [history, currentMoveIndex, currentEval, isSearching]);

    const maxEvalClamp = 1200;
    const chartHeight = 210;
    const chartWidth = Math.max(420, points.length * 32);
    const padding = { top: 16, right: 18, bottom: 34, left: 38 };
    const plotWidth = chartWidth - padding.left - padding.right;
    const plotHeight = chartHeight - padding.top - padding.bottom;

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

    const onChartClick = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!onNavigate || points.length === 0) return;
        const nearest = nearestPointForEvent(event);
        onNavigate(points[nearest].moveIndex);
    };

    return (
        <div className="graph-wrap">
            <div className="graph-scroll">
                <svg
                    className="winrate-graph"
                    width={chartWidth}
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    onClick={onChartClick}
                    onMouseMove={(event) => setHoverPointIndex(nearestPointForEvent(event))}
                    onMouseLeave={() => setHoverPointIndex(null)}
                    style={{ cursor: onNavigate ? 'pointer' : 'default' }}
                    aria-label="Evaluation graph"
                >
                    {[1000, 500, 0, -500, -1000].map((score) => {
                        const y = yFor(score);
                        return (
                            <g key={`grid-${score}`}>
                                <line
                                    className="graph-grid-line"
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
                                r={pointIndex === currentPointIndex ? 4.2 : pointIndex === hoverPointIndex ? 3.8 : 2.8}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onNavigate?.(point.moveIndex);
                                }}
                            />
                            {(() => {
                                const variationCount = point.moveIndex === -1
                                    ? rootBranchCount
                                    : branchCounts[point.moveIndex] ?? 0;
                                if (variationCount <= 1) return null;
                                return (
                                    <g
                                        className="graph-branch-badge"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onNavigate?.(point.moveIndex);
                                        }}
                                    >
                                        <rect
                                            x={xFor(pointIndex) + 5}
                                            y={yFor(point.eval) - 18}
                                            width={16}
                                            height={11}
                                            rx={5}
                                        />
                                        <text
                                            x={xFor(pointIndex) + 13}
                                            y={yFor(point.eval) - 10}
                                            textAnchor="middle"
                                        >
                                            {variationCount}
                                        </text>
                                    </g>
                                );
                            })()}
                        </g>
                    ))}
                </svg>
            </div>
            <div className="graph-legend">
                <span>{currentPoint?.moveIndex === -1 ? 'Start Position' : `Ply ${currentPoint?.ply ?? 0}`}</span>
                <strong>{currentDisplay}</strong>
            </div>
            {hoveredPoint ? (
                <div
                    className="graph-tooltip"
                    style={{
                        left: `${xFor(hoverPointIndex ?? 0)}px`,
                        top: `${Math.max(18, yFor(hoveredPoint.eval) - 18)}px`,
                    }}
                >
                    {hoveredPoint.moveIndex === -1 ? 'Start' : `Ply ${hoveredPoint.ply}`} - {formatEval(hoveredPoint.eval)}
                </div>
            ) : null}
        </div>
    );
});

EvalGraph.displayName = 'EvalGraph';

function formatEval(score: number): string {
    const sign = score > 0 ? '+' : '';
    return `${sign}${(score / 100).toFixed(2)}`;
}
