import React, { useMemo } from 'react';

interface ArrowDef {
    from: { file: number; rank: number };
    to: { file: number; rank: number };
    color: string;
    opacity?: number;
}

interface BoardArrowsProps {
    arrows: ArrowDef[];
    orientation: 'red' | 'black';
}

// Mirror Board.tsx coordinate helpers — must match the 28px inset + percentage grid
function leftFor(file: number): number {
    return (file / 8) * 100;
}

function topFor(rank: number, orientation: 'red' | 'black'): number {
    if (orientation === 'black') return (rank / 9) * 100;
    return ((9 - rank) / 9) * 100;
}

// Arrow geometry constants
const ARROW_HEAD_SIZE = 9;
const ARROW_STROKE = 5;
// Offset the arrow tip so it doesn't obscure the piece centre
const PIECE_RADIUS_PERCENT = 5.5;

export function BoardArrows({ arrows, orientation }: BoardArrowsProps) {
    const rendered = useMemo(() => {
        return arrows.map((arrow, i) => {
            if (
                arrow.from.file === arrow.to.file &&
                arrow.from.rank === arrow.to.rank
            ) return null;

            const x1 = leftFor(arrow.from.file);
            const y1 = topFor(arrow.from.rank, orientation);
            const x2 = leftFor(arrow.to.file);
            const y2 = topFor(arrow.to.rank, orientation);

            // Shorten the arrow so it doesn't overlap pieces
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len === 0) return null;
            const ux = dx / len;
            const uy = dy / len;

            // Shrink both ends by PIECE_RADIUS_PERCENT
            const sx = x1 + ux * PIECE_RADIUS_PERCENT;
            const sy = y1 + uy * PIECE_RADIUS_PERCENT;
            const ex = x2 - ux * PIECE_RADIUS_PERCENT;
            const ey = y2 - uy * PIECE_RADIUS_PERCENT;

            const markerId = `arrow-head-${i}`;

            return (
                <g key={i} opacity={arrow.opacity ?? 0.82}>
                    <defs>
                        <marker
                            id={markerId}
                            markerWidth={ARROW_HEAD_SIZE}
                            markerHeight={ARROW_HEAD_SIZE}
                            refX={ARROW_HEAD_SIZE - 1}
                            refY={ARROW_HEAD_SIZE / 2}
                            orient="auto"
                        >
                            <path
                                d={`M 0 0 L ${ARROW_HEAD_SIZE} ${ARROW_HEAD_SIZE / 2} L 0 ${ARROW_HEAD_SIZE} Z`}
                                fill={arrow.color}
                            />
                        </marker>
                    </defs>
                    <line
                        x1={`${sx}%`}
                        y1={`${sy}%`}
                        x2={`${ex}%`}
                        y2={`${ey}%`}
                        stroke={arrow.color}
                        strokeWidth={ARROW_STROKE}
                        strokeLinecap="round"
                        markerEnd={`url(#${markerId})`}
                    />
                </g>
            );
        });
    }, [arrows, orientation]);

    return (
        <svg
            style={{
                position: 'absolute',
                inset: 28,
                width: 'calc(100% - 56px)',
                height: 'calc(100% - 56px)',
                pointerEvents: 'none',
                zIndex: 8,
                overflow: 'visible',
            }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
        >
            {rendered}
        </svg>
    );
}
