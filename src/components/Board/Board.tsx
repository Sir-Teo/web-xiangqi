import React from 'react';
import './Board.css';

// Xiangqi board ranks and files
const RANKS = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const FILES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

interface Piece {
    type: string; // 'K', 'A', 'B', 'N', 'R', 'C', 'P' (uppercase for Red, lowercase for Black)
    color: 'red' | 'black';
    label: string;
}

const PIECE_LABELS: Record<string, string> = {
    K: "帥", A: "仕", B: "相", N: "傌", R: "俥", C: "炮", P: "兵",
    k: "將", a: "士", b: "象", n: "馬", r: "車", c: "砲", p: "卒"
};

// Simplified FEN parse
function parseFen(fen: string): Record<string, Piece> {
    const pieces: Record<string, Piece> = {};
    const placement = fen.split(' ')[0];
    const rows = placement.split('/');

    rows.forEach((row, rankIdx) => {
        let fileIdx = 0;
        for (const char of row) {
            if (/[1-9]/.test(char)) {
                fileIdx += parseInt(char, 10);
            } else {
                const rank = 9 - rankIdx; // 9 = red side bottom, 0 = black side top
                const isRed = char === char.toUpperCase();
                pieces[`${fileIdx},${rank}`] = {
                    type: char,
                    color: isRed ? 'red' : 'black',
                    label: PIECE_LABELS[char] || char
                };
                fileIdx++;
            }
        }
    });

    return pieces;
}

interface BoardProps {
    fen?: string;
}

export const Board: React.FC<BoardProps> = ({
    fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w"
}) => {

    const pieces = parseFen(fen);

    return (
        <div className="xiangqi-board-container">
            <div className="xiangqi-board">
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

                {/* The piece layer */}
                <div className="pieces-layer">
                    {Object.entries(pieces).map(([coord, piece]) => {
                        const [file, rank] = coord.split(',').map(Number);

                        // Calculate absolute position (0-100%)
                        // 9 files (0-8) -> each interval is 12.5% (100% / 8) -> Wait pieces are centered!
                        // Actually, because pieces are on intersections:
                        // x = file * (100% / 8)
                        // y = (9 - rank) * (100% / 9)

                        const left = `${(file / 8) * 100}%`;
                        const top = `${((9 - rank) / 9) * 100}%`;

                        return (
                            <div
                                key={coord}
                                className={`piece ${piece.color}`}
                                style={{ left, top, transform: 'translate(-50%, -50%)' }}
                            >
                                {piece.label}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
