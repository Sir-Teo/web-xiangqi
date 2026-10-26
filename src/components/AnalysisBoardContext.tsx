import type { BoardState } from '../utils/xiangqi';
import { pieceLabel, type PieceStyle } from '../utils/pieceStyle';
import type { BoardOrientation } from './Board/Board';

/** A single return control keeps position context without duplicating board interactions. */
export function AnalysisBoardContext({ board, orientation, pieceStyle, positionLabel, onReturn }: {
  board: BoardState;
  orientation: BoardOrientation;
  pieceStyle: PieceStyle;
  positionLabel: string;
  onReturn: () => void;
}) {
  const x = (file: number) => 10 + (orientation === 'red' ? file : 8 - file) * 12;
  const y = (rank: number) => 10 + (orientation === 'red' ? 9 - rank : rank) * 12;
  return <button type="button" className="analysis-board-context" onClick={onReturn}>
    <svg viewBox="0 0 116 128" aria-hidden="true" focusable="false">
      <rect width="116" height="128" rx="5" fill="#ead3a5" />
      <g stroke="#85714f" strokeWidth="0.5">
        {Array.from({ length: 10 }, (_, rank) => <path key={`r${rank}`} d={`M10 ${y(rank)}H106`} />)}
        {Array.from({ length: 9 }, (_, file) => <path key={`f${file}`} d={`M${x(file)} 10V58 M${x(file)} 70V118`} />)}
        <path d="M46 10L70 34M70 10L46 34M46 94L70 118M70 94L46 118M10 58V70M106 58V70" />
      </g>
      {board.flatMap((row, rank) => row.map((piece, file) => piece ? <g key={`${file}-${rank}`} data-square={`${file}-${rank}`} data-piece={piece}>
        <circle cx={x(file)} cy={y(rank)} r="5.5" fill="#fff5dd" stroke={piece === piece.toUpperCase() ? '#a51e21' : '#292824'} strokeWidth="0.6" />
        <text x={x(file)} y={y(rank) + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill={piece === piece.toUpperCase() ? '#a51e21' : '#292824'}>{pieceLabel(piece, pieceStyle)}</text>
      </g> : null))}
    </svg>
    <span><strong>{positionLabel}</strong><span>Return to board</span></span>
  </button>;
}
