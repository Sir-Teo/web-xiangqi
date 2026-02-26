import React, { useEffect, useRef } from 'react';
import type { MoveRecord } from '../../hooks/useXiangqi';

type Props = {
    moveHistory: MoveRecord[];
    currentMoveIndex: number;
    onNavigate: (index: number) => void;
};

export function MoveListTree({ moveHistory, currentMoveIndex, onNavigate }: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll current node into view
    useEffect(() => {
        const el = document.querySelector(`[data-move-id="move-${currentMoveIndex}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentMoveIndex]);

    if (moveHistory.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '16px', color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', textAlign: 'center' }}>
                <p>Play some moves — they'll appear here.</p>
            </div>
        );
    }

    const rows: React.ReactElement[] = [];
    let i = 0;
    while (i < moveHistory.length) {
        const redMove = moveHistory[i];
        const blackMove = moveHistory[i + 1] ?? null;
        const moveNum = Math.floor(i / 2) + 1;

        // Using inline closure for onClick since it's just index passing
        const onRedClick = () => onNavigate(i);
        const onBlackClick = () => onNavigate(i + 1);

        rows.push(
            <div key={`row-${moveNum}`} className="mtree-row">
                <span className="mtree-num">{moveNum}.</span>
                <MoveChip
                    move={redMove}
                    index={i}
                    isCurrent={i === currentMoveIndex}
                    onClick={() => onNavigate(i)}
                />
                {blackMove ? (
                    <MoveChip
                        move={blackMove}
                        index={i + 1}
                        isCurrent={i + 1 === currentMoveIndex}
                        onClick={() => onNavigate(i + 1)}
                    />
                ) : <span className="mtree-spacer" />}
            </div>
        );
        i += 2;
    }

    return (
        <div className="mtree-scroll" ref={scrollRef}>
            {rows}
        </div>
    );
}

function MoveChip({ move, index, isCurrent, onClick }: { move: MoveRecord, index: number, isCurrent: boolean, onClick: () => void }) {
    // Simple display mapping (could be enhanced for proper Xiangqi notation later)
    const notation = `${move.piece}${move.capture ? 'x' : ''}${move.uci.substring(2, 4)}`;

    return (
        <button
            data-move-id={`move-${index}`}
            type="button"
            className={`mtree-chip ${isCurrent ? 'mtree-chip-active' : ''}`}
            onClick={onClick}
        >
            {move.uci}
        </button>
    );
}
