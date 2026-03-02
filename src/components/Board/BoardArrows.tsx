import React from 'react';

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

// Percentage position helpers — same geometry as Board.tsx
function xPct(file: number) { return `${(file / 8) * 100}%`; }
function yPct(rank: number, orientation: 'red' | 'black') {
    return orientation === 'black'
        ? `${(rank / 9) * 100}%`
        : `${((9 - rank) / 9) * 100}%`;
}

const STROKE = 5;
// Arrowhead: markerUnits="userSpaceOnUse" keeps pixel size regardless of viewBox/scale
const HEAD_PX = 14;

export function BoardArrows({ arrows, orientation }: BoardArrowsProps) {
    if (arrows.length === 0) return null;

    return (
        // No viewBox — native pixel coordinate space so markers aren't distorted
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
        >
            <defs>
                {arrows.map((arrow, i) => (
                    <marker
                        key={i}
                        id={`ah-${i}`}
                        markerUnits="userSpaceOnUse"
                        markerWidth={HEAD_PX}
                        markerHeight={HEAD_PX}
                        refX={HEAD_PX - 1}
                        refY={HEAD_PX / 2}
                        orient="auto"
                    >
                        <path
                            d={`M 0 1 L ${HEAD_PX - 1} ${HEAD_PX / 2} L 0 ${HEAD_PX - 1} Z`}
                            fill={arrow.color}
                        />
                    </marker>
                ))}
            </defs>
            {arrows.map((arrow, i) => {
                if (arrow.from.file === arrow.to.file && arrow.from.rank === arrow.to.rank) return null;
                return (
                    <line
                        key={i}
                        x1={xPct(arrow.from.file)}
                        y1={yPct(arrow.from.rank, orientation)}
                        x2={xPct(arrow.to.file)}
                        y2={yPct(arrow.to.rank, orientation)}
                        stroke={arrow.color}
                        strokeWidth={STROKE}
                        strokeLinecap="round"
                        strokeOpacity={arrow.opacity ?? 0.82}
                        markerEnd={`url(#ah-${i})`}
                    />
                );
            })}
        </svg>
    );
}
