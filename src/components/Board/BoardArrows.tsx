import type { CSSProperties } from 'react';

interface ArrowDef {
    from: { file: number; rank: number };
    to: { file: number; rank: number };
    color: string;
    opacity?: number;
    strokeWidth?: number;
}

interface BoardArrowsProps {
    arrows: ArrowDef[];
    orientation: 'red' | 'black';
}

const VB_W = 800;
const VB_H = 900;
const CURVE_AMT = 30;  // viewBox units — perpendicular control point offset
const HEAD_SIZE = 22;  // viewBox units — arrowhead depth
const HEAD_WING = 11;  // viewBox units — arrowhead half-width

function xCoord(file: number, orientation: 'red' | 'black') {
    const visualFile = orientation === 'black' ? 8 - file : file;
    return (visualFile / 8) * VB_W;
}
function yCoord(rank: number, orientation: 'red' | 'black') {
    return orientation === 'black'
        ? (rank / 9) * VB_H
        : ((9 - rank) / 9) * VB_H;
}

export function BoardArrows({ arrows, orientation }: BoardArrowsProps) {
    if (arrows.length === 0) return null;

    return (
        <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            style={{
                position: 'absolute',
                inset: 'var(--board-pad)',
                width: 'calc(100% - 2 * var(--board-pad))',
                height: 'calc(100% - 2 * var(--board-pad))',
                pointerEvents: 'none',
                zIndex: 8,
                overflow: 'visible',
            }}
        >
            {arrows.map((arrow, index) => {
                if (arrow.from.file === arrow.to.file && arrow.from.rank === arrow.to.rank) return null;

                const opacity = arrow.opacity ?? 0.82;
                const strokeWidth = arrow.strokeWidth ?? 5;
                const key = `${index}-${arrow.from.file},${arrow.from.rank}-${arrow.to.file},${arrow.to.rank}-${arrow.color}`;

                const x1 = xCoord(arrow.from.file, orientation);
                const y1 = yCoord(arrow.from.rank, orientation);
                const x2 = xCoord(arrow.to.file, orientation);
                const y2 = yCoord(arrow.to.rank, orientation);

                // Direction and perpendicular for control point
                const dx = x2 - x1;
                const dy = y2 - y1;
                const len = Math.sqrt(dx * dx + dy * dy);
                const nx = dx / len;
                const ny = dy / len;
                // Clockwise perpendicular: (ny, -nx)
                const px = ny;
                const py = -nx;

                // Quadratic bezier control point: midpoint + perpendicular offset
                const cx = (x1 + x2) / 2 + px * CURVE_AMT;
                const cy = (y1 + y2) / 2 + py * CURVE_AMT;

                // Tangent at curve end = direction from control point to endpoint
                const tx = x2 - cx;
                const ty = y2 - cy;
                const tlen = Math.sqrt(tx * tx + ty * ty);
                const tnx = tx / tlen;
                const tny = ty / tlen;

                // Arrowhead base (where shaft ends) and wings
                const bx = x2 - tnx * HEAD_SIZE;
                const by = y2 - tny * HEAD_SIZE;
                // Perpendicular to tangent for wings: (tny, -tnx)
                const w1x = bx + tny * HEAD_WING;
                const w1y = by - tnx * HEAD_WING;
                const w2x = bx - tny * HEAD_WING;
                const w2y = by + tnx * HEAD_WING;

                const shaftPath = `M ${x1} ${y1} Q ${cx} ${cy} ${bx} ${by}`;
                const headPoints = `${x2},${y2} ${w1x},${w1y} ${w2x},${w2y}`;

                const groupStyle = { '--arrow-opacity': opacity } as CSSProperties;

                return (
                    <g key={key} className="board-arrow-group" style={groupStyle}>
                        <circle cx={x1} cy={y1} r={strokeWidth * 0.9} fill={arrow.color} />
                        <path
                            d={shaftPath}
                            stroke={arrow.color}
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                            fill="none"
                        />
                        <polygon points={headPoints} fill={arrow.color} />
                    </g>
                );
            })}
        </svg>
    );
}
