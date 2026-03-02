import React from 'react';
import './Board.css';
import type { BoardState } from '../../utils/xiangqi';
import { BoardArrows } from './BoardArrows';

const PIECE_LABELS: Record<string, string> = {
    K: "帥", A: "仕", B: "相", N: "傌", R: "俥", C: "炮", P: "兵",
    k: "將", a: "士", b: "象", n: "馬", r: "車", c: "砲", p: "卒"
};

export type BoardOrientation = 'red' | 'black';

interface BoardProps {
    board: BoardState;
    selected: { file: number, rank: number } | null;
    validTargets: { file: number, rank: number, capture: boolean }[];
    onSquareClick: (file: number, rank: number) => void;
    orientation?: BoardOrientation;
    arrows?: Array<{
        from: { file: number; rank: number };
        to: { file: number; rank: number };
        color: string;
        opacity?: number;
    }>;
}

export const Board = React.memo(function Board({
    board,
    selected,
    validTargets,
    onSquareClick,
    orientation = 'red',
    arrows = [],
}: BoardProps) {
    // When orientation='black', flip rank and file ordering
    const ranks = orientation === 'black'
        ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        : [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const files = orientation === 'black'
        ? [8, 7, 6, 5, 4, 3, 2, 1, 0]
        : [0, 1, 2, 3, 4, 5, 6, 7, 8];

    // Position helpers stay in "original coordinate space" — no flipping needed
    // because percentage positions are calculated from original file/rank values.
    const leftFor = (file: number) => `${(file / 8) * 100}%`;
    const topFor = (rank: number) => {
        if (orientation === 'black') {
            return `${(rank / 9) * 100}%`;
        }
        return `${((9 - rank) / 9) * 100}%`;
    };

    return (
        <div className="xiangqi-board-container">
            <div className="xiangqi-board">
                {/* SVG Layer for Palace Diagonal Lines */}
                <svg className="palace-lines" viewBox="0 0 8 9" preserveAspectRatio="none">
                    {orientation === 'red' ? (
                        <>
                            {/* Bottom Palace (Red) */}
                            <line x1="3" y1="7" x2="5" y2="9" className="palace-line" />
                            <line x1="5" y1="7" x2="3" y2="9" className="palace-line" />
                            {/* Top Palace (Black) */}
                            <line x1="3" y1="0" x2="5" y2="2" className="palace-line" />
                            <line x1="5" y1="0" x2="3" y2="2" className="palace-line" />
                        </>
                    ) : (
                        <>
                            {/* Flipped: Black palace now at bottom */}
                            <line x1="3" y1="7" x2="5" y2="9" className="palace-line" />
                            <line x1="5" y1="7" x2="3" y2="9" className="palace-line" />
                            <line x1="3" y1="0" x2="5" y2="2" className="palace-line" />
                            <line x1="5" y1="0" x2="3" y2="2" className="palace-line" />
                        </>
                    )}
                </svg>

                {/* Draw the physical grid lines */}
                <div className="board-grid">
                    {ranks.map(rank => (
                        files.map(file => {
                            if (orientation === 'red' && (file === 8 || rank === 0)) return null;
                            if (orientation === 'black' && (file === 0 || rank === 9)) return null;

                            return (
                                <div
                                    key={`cell-${file}-${rank}`}
                                    className="cell"
                                    data-file={file}
                                    data-rank={rank}
                                />
                            );
                        })
                    ))}
                </div>

                {/* The river dividing the board */}
                <div className="river">CHU RIVER · HAN BORDER</div>

                {/* Invisible Hitbox Layer for clicking the exact intersections */}
                <div className="hitboxes-layer">
                    {ranks.map(rank => (
                        files.map(file => (
                            <div
                                key={`hitbox-${file}-${rank}`}
                                className="hitbox"
                                style={{ left: leftFor(file), top: topFor(rank) }}
                                onClick={() => onSquareClick(file, rank)}
                            />
                        ))
                    ))}
                </div>

                {/* Arrow overlay */}
                {arrows.length > 0 && (
                    <BoardArrows arrows={arrows} orientation={orientation} />
                )}

                {/* The piece layer */}
                <div className="pieces-layer">
                    {/* Valid Target overlays */}
                    {validTargets.map(target => {
                        if (target.capture) {
                            return (
                                <div
                                    key={`target-${target.file}-${target.rank}`}
                                    className="target-ring"
                                    style={{ left: leftFor(target.file), top: topFor(target.rank) }}
                                />
                            );
                        } else {
                            return (
                                <div
                                    key={`target-${target.file}-${target.rank}`}
                                    className="target-dot"
                                    style={{ left: leftFor(target.file), top: topFor(target.rank) }}
                                />
                            );
                        }
                    })}

                    {/* Pieces */}
                    {ranks.map(rank => (
                        files.map(file => {
                            const piece = board[rank][file];
                            if (!piece) return null;

                            const isSelected = selected?.file === file && selected?.rank === rank;
                            const isRed = piece === piece.toUpperCase();
                            const colorClass = isRed ? 'red' : 'black';

                            return (
                                <div
                                    key={`piece-${file}-${rank}`}
                                    className={`piece ${colorClass} ${isSelected ? 'selected' : ''}`}
                                    style={{ left: leftFor(file), top: topFor(rank) }}
                                >
                                    {PIECE_LABELS[piece] || piece}
                                </div>
                            );
                        })
                    ))}
                </div>
            </div>
        </div>
    );
});

Board.displayName = 'Board';
