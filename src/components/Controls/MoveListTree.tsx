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

    const rows: React.ReactElement[] = [];
    let i = 0;
    while (i < moveHistory.length) {
        const redMove = moveHistory[i];
        const blackMove = moveHistory[i + 1] ?? null;
        const moveNum = Math.floor(i / 2) + 1;

        rows.push(
            <div key={`row-${moveNum}`} className="mtree-row">
                <span className="mtree-num">{moveNum}.</span>
                <MoveChip
                    move={redMove}
                    history={moveHistory}
                    index={i}
                    isCurrent={i === currentMoveIndex}
                    onClick={() => onNavigate(i)}
                />
                {blackMove ? (
                    <MoveChip
                        move={blackMove}
                        history={moveHistory}
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
        <div className="mtree-wrap">
            <div className="mtree-head">
                <button
                    type="button"
                    className={`mtree-chip mtree-chip-root ${currentMoveIndex === -1 ? 'mtree-chip-active' : ''}`}
                    onClick={() => onNavigate(-1)}
                >
                    Start Position
                </button>
                <span className="mtree-progress">{Math.max(0, currentMoveIndex + 1)} / {moveHistory.length}</span>
            </div>
            {moveHistory.length === 0 ? (
                <div className="empty-state" style={{ padding: '12px 4px', color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', textAlign: 'center' }}>
                    <p>Play some moves - they will appear here.</p>
                </div>
            ) : (
                <div className="mtree-scroll" ref={scrollRef}>
                    {rows}
                </div>
            )}
        </div>
    );
}

function MoveChip({ move, history, index, isCurrent, onClick }: { move: MoveRecord, history: MoveRecord[], index: number, isCurrent: boolean, onClick: () => void }) {
    const notation = `${move.piece.toUpperCase()}${move.captured ? 'x' : '-'}${move.uci.substring(2, 4)}`;
    const qualityClass = getMoveQualityClass(history, index);

    return (
        <button
            data-move-id={`move-${index}`}
            type="button"
            className={`mtree-chip ${qualityClass} ${isCurrent ? 'mtree-chip-active' : ''}`}
            onClick={onClick}
            title={`${notation} (${move.uci})`}
        >
            <span>{notation}</span>
            <span className="move-uci">{move.uci}</span>
            <span className="mtree-quality-dot" />
        </button>
    );
}

function getMoveQualityClass(history: MoveRecord[], index: number): string {
    const currentEval = history[index]?.evalScore;
    const previousEval = index > 0 ? history[index - 1]?.evalScore : 0;
    if (typeof currentEval !== 'number' || typeof previousEval !== 'number') return 'quality-pending';

    const delta = Math.abs(currentEval - previousEval);
    if (delta <= 40) return 'quality-best';
    if (delta <= 90) return 'quality-good';
    if (delta <= 180) return 'quality-inaccuracy';
    if (delta <= 320) return 'quality-mistake';
    return 'quality-blunder';
}
