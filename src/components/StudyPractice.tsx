import { readPracticeProgress, writePracticeProgress } from '../utils/practiceProgress';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SavedGame } from '../utils/gameLibrary';
import type { PieceStyle } from '../utils/pieceStyle';
import { formatMoveInStyle, formatLineTokensInStyle, type XiangqiNotationStyle } from '../utils/xiangqiNotation';
import { isInCheck, legalMovesFrom, pieceSide, squareToUci, uciToSquare, type Side } from '../utils/xiangqi';
import { attemptPracticeMove, nextPracticeLine, playPracticeReply, practiceComplete, practiceLineIndices, preparePracticeStudy, startPracticeLine, type PracticeSession } from '../utils/studyPractice';
import { Board } from './Board/Board';
import { IconCheck } from './icons';
import { PracticeLinePicker } from './PracticeLinePicker';

export function StudyPractice({ game, pieceStyle, notationStyle = 'wxf' }: { game: SavedGame; pieceStyle: PieceStyle; notationStyle?: XiangqiNotationStyle }) {
  const prepared = useMemo(() => preparePracticeStudy(game), [game]);
  const study = prepared.study;
  const sideLines = useMemo(() => ({
    w: study ? practiceLineIndices(study, 'w') : [],
    b: study ? practiceLineIndices(study, 'b') : [],
  }), [study]);
  const restored = useMemo(() => study ? readPracticeProgress(game, study) : null, [game, study]);
  const [side, setSide] = useState<Side>(() => restored?.side ?? study?.side ?? 'w');
  const [session, setSession] = useState(() => restored?.session ?? (study ? startPracticeLine(study, 0) : null));
  const [resetUndo, setResetUndo] = useState<{ side: Side; session: PracticeSession } | null>(null);
  const [progressSaved, setProgressSaved] = useState(true);
  const [saveRetryResult, setSaveRetryResult] = useState<'failed' | 'saved' | null>(null);
  useEffect(() => {
    if (session && sideLines[side].length) {
      setProgressSaved(writePracticeProgress(game, side, session));
      setSaveRetryResult(null);
    }
  }, [game, side, session, sideLines]);
  const [selected, setSelected] = useState<{ file: number; rank: number } | null>(null);
  const [letters, setLetters] = useState(pieceStyle === 'letters');
  const [hint, setHint] = useState(false);
  const [message, setMessage] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const feedbackId = useId();
  const nextRef = useRef<HTMLButtonElement>(null);
  const replyRef = useRef<HTMLButtonElement>(null);
  const focusBoardRef = useRef(false);
  const focusFrameRef = useRef<number | null>(null);
  const revealFeedbackRef = useRef(false);
  const eligible = sideLines[side];
  const complete = Boolean(study && session && practiceComplete(study, session));
  const asking = Boolean(session && session.side === side && !complete && eligible.length);
  const validTargets = useMemo(() => session && selected && asking
    ? legalMovesFrom(session.board, selected.file, selected.rank, side) : [], [session, selected, asking, side]);
  useEffect(() => {
    const frame = focusFrameRef;
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  useLayoutEffect(() => {
    if (!focusBoardRef.current) return;
    focusBoardRef.current = false;
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    const target = complete ? nextRef.current : !asking ? replyRef.current
      : boardRef.current?.querySelector<HTMLElement>('.hitbox[tabindex="0"]');
    target?.focus({ preventScroll: true });
    // Wait for the dialog's responsive layout: WebKit can focus a newly
    // mounted control before its final position is available for scrolling.
    // Saving progress can render a storage warning before this frame runs.
    // Keep the reveal pending through that update, and skip it if focus moved.
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (target === document.activeElement) target?.scrollIntoView({ block: 'nearest' });
    });
  });
  useEffect(() => {
    if ((message || hint) && revealFeedbackRef.current) feedbackRef.current?.scrollIntoView({ block: 'nearest' });
    revealFeedbackRef.current = false;
  }, [message, hint]);
  if (!study || !session) return <p role="alert">{prepared.error}</p>;

  function reset(line: number, keepProgress: boolean) {
    if (!study || !session) return;
    if (keepProgress) setResetUndo(null);
    setSession(startPracticeLine(study, line, keepProgress ? session : undefined));
    setSelected(null); setHint(false); setMessage(''); setNotesOpen(false);
    focusBoardRef.current = true;
  }
  function clickSquare(file: number, rank: number) {
    if (!study || !session || !asking) return;
    if (pieceSide(session.board[rank][file]) === side) {
      setSelected(selected?.file === file && selected.rank === rank ? null : { file, rank });
      return;
    }
    revealFeedbackRef.current = true;
    if (!selected) { setMessage(`Select a ${side === 'w' ? 'red' : 'black'} piece first.`); return; }
    const result = attemptPracticeMove(study, session, side, squareToUci(selected.file, selected.rank) + squareToUci(file, rank));
    setSession(result.session); setMessage(result.message);
    if (result.matched) {
      setResetUndo(null);
      setSelected(null); setHint(false);
      // The next action can be below the board on a phone. Keep keyboard
      // practice moving through reply/next controls and let focus reveal it.
      focusBoardRef.current = true;
      revealFeedbackRef.current = false;
    }
  }
  const next = nextPracticeLine(study, session, side);
  const lineLength = study.lineLengths[session.line];
  const nextMove = study.lines[session.line]?.[session.moves.length];
  const completedNotes = complete ? study.notes[session.line] : [];
  const noteTokens = notesOpen && complete ? formatLineTokensInStyle(study.board, study.lines[session.line], notationStyle, study.lineLengths[session.line]).tokens : [];
  const turnMessage = complete ? 'Line complete.' : asking ? `${side === 'w' ? 'Red' : 'Black'} to move.` : 'Play the saved reply to continue.';
  return <div className="study-practice-layout">
    <div className="study-practice-controls">
      <label>Practice as<select className="app-select app-select-roomy" value={side} onChange={event => {
        const chosen = event.target.value as Side;
        setResetUndo(null);
        setSide(chosen);
        const first = sideLines[chosen][0];
        if (first !== undefined) setSession(readPracticeProgress(game, study, chosen)?.session ?? startPracticeLine(study, first));
        setSelected(null); setHint(false); setMessage(''); setNotesOpen(false);
      }}><option value="w" disabled={!sideLines.w.length}>Red{!sideLines.w.length ? ' (no saved moves)' : ''}</option>
        <option value="b" disabled={!sideLines.b.length}>Black{!sideLines.b.length ? ' (no saved moves)' : ''}</option></select></label>
      <button type="button" onClick={() => {
        setResetUndo(previous => previous?.side === side ? previous : { side, session });
        reset(eligible[0] ?? 0, false);
        // Keep focus on Reset so Tab can reach Undo before practice resumes.
        focusBoardRef.current = false;
        setMessage(`Progress reset for ${side === 'w' ? 'Red' : 'Black'}.`);
      }}>Reset progress for this side</button>
      {resetUndo?.side === side && <button type="button" onClick={() => {
        setSession(resetUndo.session); setResetUndo(null);
        setSelected(null); setHint(false); setNotesOpen(false); setMessage('Reset undone.');
        focusBoardRef.current = true;
      }}>Undo reset</button>}
      <button type="button" className="letter-pieces-toggle" onClick={() => setLetters(value => !value)} aria-pressed={letters}><IconCheck className="letter-pieces-check" />Letter pieces</button>
    </div>
    {eligible.length === 0 ? <p role="status">This study has no moves for {side === 'w' ? 'Red' : 'Black'}. Choose the other side.</p> : <>
      <div className="study-practice-board" ref={boardRef}>
        <Board board={session.board} orientation={side === 'w' ? 'red' : 'black'} selected={selected} validTargets={validTargets}
          draggableSide={asking ? side : null} onSquareClick={clickSquare} inCheck={isInCheck(session.board, session.side)}
          notationStyle={notationStyle}
          pieceStyle={letters ? 'letters' : pieceStyle === 'letters' ? 'traditional' : pieceStyle}
          highlights={hint && nextMove ? [uciToSquare(nextMove.slice(0, 2))!, uciToSquare(nextMove.slice(2))!] : []} />
      </div>
      <section className="study-practice-feedback" aria-label="Practice feedback">
        <p id={feedbackId} role="status" aria-atomic="true" ref={feedbackRef} data-testid="study-practice-status">
          <span className="study-practice-line-position" data-testid="study-practice-line-position">
            Line {eligible.indexOf(session.line) + 1} of {eligible.length} · {session.moves.length} of {lineLength} {lineLength === 1 ? 'move' : 'moves'} played
          </span>{' '}
          {message ? `${message} ${turnMessage}` : asking
          ? `${turnMessage} Choose a piece, then its destination. You can also use the board’s arrow keys and Enter.` : turnMessage}
          {hint && nextMove && <span className="study-practice-hint" data-testid="study-practice-hint"> One saved move: {formatMoveInStyle(session.board, nextMove, notationStyle)}</span>}
        </p>
        <div className="study-practice-actions">
          {asking && <button type="button" aria-expanded={hint} aria-controls={feedbackId} onClick={() => {
            revealFeedbackRef.current = !hint; setHint(!hint);
            if (!hint) setSession({ ...session, assisted: true });
          }}>{hint ? 'Hide saved move' : 'Show a saved move'}</button>}
          {!asking && !complete && <button type="button" ref={replyRef} onClick={() => {
            setResetUndo(null);
            setSession(playPracticeReply(study, session, side)); setSelected(null); setHint(false);
            setMessage(`${session.side === 'w' ? 'Red' : 'Black'} played ${formatMoveInStyle(session.board, nextMove, notationStyle)}.`);
            focusBoardRef.current = true;
          }}>Play saved reply</button>}
          {complete && next !== undefined && <button type="button" ref={nextRef} onClick={() => reset(next, true)}>
            {session.completed.filter(line => eligible.includes(line)).length === eligible.length ? 'Practice again' : 'Next line'}
          </button>}
          <button type="button" onClick={() => reset(session.line, true)}>Restart line</button>
        </div>
        {eligible.length > 1 && <PracticeLinePicker key={`${side}:${session.line}`}
          current={eligible.indexOf(session.line) + 1} total={eligible.length}
          onStart={ordinal => reset(eligible[ordinal - 1], true)} />}
        <p data-testid="study-practice-progress">{session.completed.filter(line => eligible.includes(line)).length} of {eligible.length} {eligible.length === 1 ? 'line' : 'lines'} practiced</p>
        {session.answered > 0 && <p data-testid="study-practice-recall">{session.recalled} of {session.answered} {session.answered === 1 ? 'move' : 'moves'} recalled without help</p>}
        {(!progressSaved || saveRetryResult === 'saved') && <div className="study-practice-save-notice" data-testid="practice-progress-save">
          <p role="status">{progressSaved ? 'Practice progress saved in this browser.' : saveRetryResult === 'failed'
            ? 'Practice continues, but browser storage still could not save your progress.'
            : 'Practice continues, but browser storage could not save your progress.'}</p>
          {!progressSaved && <button type="button" onClick={event => {
            const saved = writePracticeProgress(game, side, session);
            setProgressSaved(saved); setSaveRetryResult(saved ? 'saved' : 'failed');
            if (saved && document.activeElement === event.currentTarget) focusBoardRef.current = true;
          }}>Retry saving progress</button>}
        </div>}
        {completedNotes.length > 0 && <details className="study-practice-note study-practice-line-notes" data-testid="study-practice-line-notes"
          onToggle={event => setNotesOpen(event.currentTarget.open)}>
          <summary>Study notes for this line ({completedNotes.length})</summary>
          {notesOpen && <ul>{completedNotes.map((note, index) => <li key={index}>
            <strong>{note.move ? `Ply ${note.ply} · ${noteTokens[note.ply - 1] ?? note.move}` : 'Start position'}</strong>
            <p>{note.comment}</p>
          </li>)}</ul>}
        </details>}
        <details className="study-practice-note"><summary>How practice works</summary>
          <p>Recall moves from your saved study. Any stored continuation is accepted; other legal moves may also be good.</p>
          <p>Complete a line to read any notes saved with it.</p>
          <p>Use Choose a line to start any line for this side while keeping your scores and completed lines.</p>
          <p>Progress is saved in this browser for your 50 most recent studies, separately for each side. Changing the saved moves, study notes or the starting position starts fresh practice.</p>
          <p>Use Undo reset to recover the position and scores from before a progress reset.</p>
        </details>
      </section>
    </>}
  </div>;
}
