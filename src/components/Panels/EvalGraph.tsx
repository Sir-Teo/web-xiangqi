import React, { useMemo } from 'react';
import type { MoveRecord } from '../../hooks/useXiangqi';

interface EvalGraphProps {
    history: MoveRecord[];
    currentMoveIndex: number;
    currentEval: number;
    onNavigate?: (index: number) => void;
}

type EvalPoint = {
    moveIndex: number;
    eval: number;
    ply: number;
};

export const EvalGraph: React.FC<EvalGraphProps> = ({ history, currentMoveIndex, currentEval, onNavigate }) => {
    const points = useMemo<EvalPoint[]>(() => {
        let previous = 0;
        const next: EvalPoint[] = [{ moveIndex: -1, eval: 0, ply: 0 }];
        history.forEach((move, index) => {
            if (typeof move.evalScore === 'number') previous = move.evalScore;
            next.push({ moveIndex: index, eval: previous, ply: index + 1 });
        });

        // Always project the live engine score onto the currently viewed ply
        // so the graph updates while analyzing start position or historical steps.
        const activePointIndex = Math.max(0, Math.min(next.length - 1, currentMoveIndex + 1));
        next[activePointIndex] = {
            ...next[activePointIndex],
            eval: currentEval,
        };
        return next;
    }, [history, currentMoveIndex, currentEval]);

    const maxEvalClamp = 1200;
    const chartHeight = 190;
    const chartWidth = Math.max(360, points.length * 34);
    const padding = { top: 16, right: 18, bottom: 32, left: 38 };
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
    }, [points]);

    const fillPath = useMemo(() => {
        if (points.length === 0) return '';
        const lastX = xFor(points.length - 1);
        return `${linePath} L ${lastX.toFixed(2)} ${baselineY.toFixed(2)} L ${xFor(0).toFixed(2)} ${baselineY.toFixed(2)} Z`;
    }, [points, linePath, baselineY]);

    const currentPointIndex = Math.max(0, Math.min(points.length - 1, currentMoveIndex + 1));
    const currentPoint = points[currentPointIndex];
    const currentDisplay = formatEval(currentPoint?.eval ?? 0);

    const onChartClick = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!onNavigate || points.length === 0) return;
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
                        <linearGradient id="graph-gradient-xiangqi" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(16, 185, 129, 0.35)" />
                            <stop offset="100%" stopColor="rgba(16, 185, 129, 0.03)" />
                        </linearGradient>
                    </defs>
                    <path className="graph-area" d={fillPath} fill="url(#graph-gradient-xiangqi)" />
                    <path className="graph-line" d={linePath} />
                    <line
                        x1={xFor(currentPointIndex)}
                        x2={xFor(currentPointIndex)}
                        y1={padding.top}
                        y2={chartHeight - padding.bottom}
                        stroke="rgba(255, 255, 255, 0.65)"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                    />
                    {points.map((point, pointIndex) => (
                        <circle
                            key={`point-${point.ply}`}
                            className={`graph-point ${pointIndex === currentPointIndex ? 'graph-point-active' : ''}`}
                            cx={xFor(pointIndex)}
                            cy={yFor(point.eval)}
                            r={pointIndex === currentPointIndex ? 4 : 2.8}
                            onClick={(event) => {
                                event.stopPropagation();
                                onNavigate?.(point.moveIndex);
                            }}
                        />
                    ))}
                </svg>
            </div>
            <div className="graph-legend">
                <span>{currentPoint?.moveIndex === -1 ? 'Start Position' : `Ply ${currentPoint?.ply ?? 0}`}</span>
                <strong>{currentDisplay}</strong>
            </div>
        </div>
    );
};

function formatEval(score: number): string {
    const sign = score > 0 ? '+' : '';
    return `${sign}${(score / 100).toFixed(2)}`;
}
