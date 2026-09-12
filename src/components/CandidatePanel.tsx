import { useMemo, useRef, useEffect, useState } from 'react';
import type { PvLine } from '../hooks/useEngine';
import { legalCandidateMoves, MAX_CANDIDATE_MOVES } from '../utils/candidateSearch';
import { formatRedPovEngineScore } from '../utils/engineScore';
import { copyToClipboard } from '../utils/gameExport';
import { PIECE_NAMES, isPieceCode } from '../utils/material';
import { uciToSquare, type BoardState, type Side } from '../utils/xiangqi';
import { formatLineTokensInStyle, formatMoveInStyle, type XiangqiNotationStyle } from '../utils/xiangqiNotation';
import { MoveLineStrip } from './Controls/MoveLineStrip';
import './CandidatePanel.css';

type Props = {
  board: BoardState;
  side: Side;
  notation: XiangqiNotationStyle;
  active: boolean;
  completed: boolean;
  searching: boolean;
  canCompare: boolean;
  canPlay: boolean;
  budgetLabel: string;
  lines: PvLine[];
  onCompare: (moves: string[]) => void;
  onEdit: () => void;
  onClose: () => void;
  onStop: () => void;
  onPlay: (moves: string[], count: number) => void;
  onKeep: (moves: string[]) => void;
  isKept: (moves: string[]) => boolean;
  hasLine: (moves: string[]) => boolean;
};

export function CandidatePanel(props: Props) {
  const { board, side, notation } = props;
  const [selected, setSelected] = useState<string[]>([]);
  const [choice, setChoice] = useState('');
  const [copyStatus, setCopyStatus] = useState<{ line: string; ok: boolean } | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { selectRef.current?.focus({ preventScroll: true }); }, []);
  const choices = useMemo(() => legalCandidateMoves(board, side).map(uci => {
    const square = uciToSquare(uci.slice(0, 2));
    const piece = square ? board[square.rank][square.file] : '';
    const name = isPieceCode(piece) ? PIECE_NAMES[piece] : '';
    return { uci, label: `${formatMoveInStyle(board, uci, notation)} · ${name} ${uci.slice(0, 2)} → ${uci.slice(2)}` };
  }), [board, side, notation]);
  const copy = async (moves: string[]) => {
    const line = moves.join(' ');
    try { const ok = await copyToClipboard(line); setCopyStatus({ line, ok }); }
    catch { setCopyStatus({ line, ok: false }); }
  };

  return <section id="candidate-comparison" className="candidate-panel" aria-label="Compare candidate moves" data-testid="candidate-panel">
    <div className="candidate-heading"><h3>Compare candidate moves</h3>
      <button type="button" onClick={props.onClose} aria-label="Close candidate comparison">Close</button></div>
    <p>Choose up to {MAX_CANDIDATE_MOVES} legal moves. Scores apply only to these choices.</p>
    <div className="candidate-picker">
      <label htmlFor="candidate-move">Candidate move</label>
      <select className="app-select" id="candidate-move" aria-describedby={choice ? 'candidate-choice-description' : undefined} ref={selectRef} value={choice} onChange={event => setChoice(event.target.value)}
        disabled={!props.canCompare || selected.length >= MAX_CANDIDATE_MOVES}>
        <option value="">Choose a legal move…</option>
        {choices.map(option => <option key={option.uci} value={option.uci} disabled={selected.includes(option.uci)}>{option.label}</option>)}
      </select>
      <button type="button" disabled={!choice || !props.canCompare || selected.length >= MAX_CANDIDATE_MOVES}
        onClick={() => { props.onEdit(); setSelected(previous => previous.includes(choice) ? previous : [...previous, choice]); setChoice(''); }}>Add move</button>
      {choice && <span className="candidate-choice-description" id="candidate-choice-description">{choices.find(option => option.uci === choice)?.label}</span>}
    </div>
    <ul className="candidate-selections" aria-label="Selected moves">
      {selected.map(uci => <li key={uci}><span>{formatMoveInStyle(board, uci, notation)}</span>
        <button type="button" disabled={!props.canCompare} onClick={() => { props.onEdit(); setSelected(previous => previous.filter(move => move !== uci)); }}
          aria-label={`Remove candidate ${uci}`}>×</button></li>)}
    </ul>
    <span className="candidate-count" role="status">{selected.length} of {MAX_CANDIDATE_MOVES} selected</span>
    <div className="candidate-actions">
      <button type="button" onClick={() => props.onCompare(selected)} disabled={!selected.length || !props.canCompare}
        data-testid="compare-candidates">Compare</button>
      {props.active && props.searching ? <button type="button" onClick={props.onStop}>Stop comparison</button> : null}
    </div>
    <p className="candidate-budget">{props.budgetLabel}. After comparing, use Go Deep above for a longer search of those candidates.</p>
    {props.active ? <div className="candidate-results" data-testid="candidate-results">
      <h4>Selected candidates only</h4>
      <p>{props.searching ? 'Comparing…' : props.completed ? 'Comparison finished.' : 'Preparing comparison…'} The position evaluation is paused.</p>
      {!props.lines.length && props.completed ? <p>No candidate line returned. Try comparing again.</p> : null}
      {props.lines.map(pv => {
        const root = pv.moves[0];
        const tokens = formatLineTokensInStyle(board, pv.moves, notation, 8);
        const copied = copyStatus?.line === pv.moves.join(' ') ? copyStatus : null;
        return <article className="candidate-line" key={root} data-testid={`candidate-line-${root}`}>
          <div className="candidate-heading"><strong>{formatMoveInStyle(board, root, notation)}</strong>
            <span title={pv.bounded ? 'This score is a bound; an exact evaluation is not available yet.' : undefined}>
              {formatRedPovEngineScore(pv, side)} Red POV · Depth {pv.depth}{pv.bounded ? ' · Not exact' : ''}
            </span></div>
          <MoveLineStrip tokens={tokens.tokens} remaining={tokens.remaining} disabled={!props.canPlay}
            onPlay={count => props.onPlay(pv.moves, count)}
            title={(_, token) => `Follow candidate line through ${token}`}
            ariaLabel={(index, token) => `Follow candidate ${root} through move ${index + 1}, ${token}`}
            testId={index => `candidate-${root}-move-${index}`} />
          <div className="candidate-actions">
            <button type="button" disabled={!props.canPlay || props.isKept(pv.moves)} onClick={() => props.onKeep(pv.moves)}
              data-testid={`keep-candidate-${root}`}>{props.isKept(pv.moves) ? 'Kept' : props.hasLine(pv.moves) ? 'Update analysis' : 'Keep line'}</button>
            <button type="button" onClick={() => void copy(pv.moves)} title="Copy this continuation as UCI moves"
              data-testid={`copy-candidate-${root}`}>{copied ? copied.ok ? 'Copied' : 'Copy failed' : 'Copy line'}</button>
          </div>
        </article>;
      })}
    </div> : null}
  </section>;
}
