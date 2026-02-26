import React from 'react';
import './Board.css';
import type { BoardState } from '../../utils/xiangqi';

// Xiangqi board ranks and files
const RANKS = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const FILES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const PIECE_LABELS: Record<string, string> = {
    K: "帥", A: "仕", B: "相", N: "傌", R: "俥", C: "炮", P: "兵",
    k: "將", a: "士", b: "象", n: "馬", r: "車", c: "砲", p: "卒"
};

interface BoardProps {
    board: BoardState;
    selected: { file: number, rank: number } | null;
    validTargets: { file: number, rank: number, capture: boolean }[];
    onSquareClick: (file: number, rank: number) => void;
}

export const Board: React.FC<BoardProps> = ({
    board,
    selected,
    validTargets,
    onSquareClick
}) => {

    return (
        <div className="xiangqi-board-container">
            <div className="xiangqi-board">
                {/* SVG Layer for Palace Diagonal Lines */}
                <svg className="palace-lines" viewBox="0 0 8 9" preserveAspectRatio="none">
                    {/* Bottom Palace (Red) */}
                    <line x1="3" y1="7" x2="5" y2="9" className="palace-line" />
                    <line x1="5" y1="7" x2="3" y2="9" className="palace-line" />

                    {/* Top Palace (Black) */}
                    <line x1="3" y1="0" x2="5" y2="2" className="palace-line" />
                    <line x1="5" y1="0" x2="3" y2="2" className="palace-line" />
                </svg>

                {/* Draw the physical grid lines */}
                <div className="board-grid">
                    {RANKS.map(rank => (
                        FILES.map(file => {
                            // The grid consists of cells formed by intersecting lines.
                            // In Xiangqi, pieces sit ON the intersections, not inside the squares.
                            // However, our visual grid is a 9x10 intersections -> 8x9 squares.
                            if (file === 8 || rank === 0) return null; // No cell on the very right or bottom edge

                            return (
                                <div
                                    key={`cell-${file}-${rank}`}
                                    className="cell"
                                    data-file={file}
                                    data-rank={rank}
                                >
                                    {/* Palace cross lines or other markings can go here */}
                                </div>
                            );
                        })
                    ))}
                </div>

                {/* The river dividing the board */}
                <div className="river">CHU RIVER · HAN BORDER</div>

                {/* Invisible Hitbox Layer for clicking the exact intersections */}
                <div className="hitboxes-layer">
                    {RANKS.map(rank => (
                        FILES.map(file => {
                            const left = `${(file / 8) * 100}%`;
                            const top = `${((9 - rank) / 9) * 100}%`;

                            return (
                                <div
                                    key={`hitbox-${file}-${rank}`}
                                    className="hitbox"
                                    style={{ left, top }}
                                    onClick={() => onSquareClick(file, rank)}
                                />
                            );
                        })
                    ))}
                </div>

                {/* The piece layer */}
                <div className="pieces-layer">
                    {/* Valid Target overlays */}
                    {validTargets.map(target => {
                        const left = `${(target.file / 8) * 100}%`;
                        const top = `${((9 - target.rank) / 9) * 100}%`;

                        if (target.capture) {
                            return (
                                <div
                                    key={`target-${target.file}-${target.rank}`}
                                    className="target-ring"
                                    style={{ left, top }}
                                />
                            );
                        } else {
                            return (
                                <div
                                    key={`target-${target.file}-${target.rank}`}
                                    className="target-dot"
                                    style={{ left, top }}
                                />
                            );
                        }
                    })}

                    {RANKS.map(rank => (
                        FILES.map(file => {
                            const piece = board[rank][file];
                            if (!piece) return null;

                            const isSelected = selected?.file === file && selected?.rank === rank;
                            const isRed = piece === piece.toUpperCase();
                            const colorClass = isRed ? 'red' : 'black';
                            const left = `${(file / 8) * 100}%`;
                            const top = `${((9 - rank) / 9) * 100}%`;

                            return (
                                <div
                                    key={`piece-${file}-${rank}`}
                                    className={`piece ${colorClass} ${isSelected ? 'selected' : ''}`}
                                    style={{ left, top }}
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
}
