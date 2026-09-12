import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SavedGame } from '../utils/gameLibrary';
import type { PieceStyle } from '../utils/pieceStyle';
import { formatUciMove } from '../utils/moveNotation';
import { isInCheck, legalMovesFrom, pieceSide, squareToUci, uciToSquare, type Side } from '../utils/xiangqi';
import { attemptPracticeMove, nextPracticeLine, playPracticeReply, practiceComplete, practiceLineIndices, preparePracticeStudy, startPracticeLine } from '../utils/studyPractice';
import { Board } from './Board/Board';

export function StudyPractice({ game, pieceStyle }: { game: SavedGame; pieceStyle: PieceStyle }) {
  const prepared = useMemo(() => preparePracticeStudy(game), [game]);
  const study = prepared.study;
  const [side, setSide] = useState<Side>(() => study?.side ?? 'w');
  const [session, setSession] = useState(() => study ? startPracticeLine(study, 0) : null);
  const [selected, setSelected] = useState<{ file: number; rank: number } | null>(null);
  const [letters, setLetters] = useState(pieceStyle === 'letters');
  const [hint, setHint] = useState(false);
  const [message, setMessage] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const replyRef = useRef<HTMLButtonElement>(null);
  const focusBoardRef = useRef(false);
  const revealFeedbackRef = useRef(false);
  const eligible = study ? practiceLineIndices(study, side) : [];
  const complete = Boolean(study && session && practiceComplete(study, session));
  const asking = Boolean(session && session.side === side && !complete && eligible.length);
  const validTargets = useMemo(() => session && selected && asking
    ? legalMovesFrom(session.board, selected.file, selected.rank, side) : [], [session, selected, asking, side]);
  useLayoutEffect(() => {
    if (!focusBoardRef.current) return;
    focusBoardRef.current = false;
    const target = complete ? nextRef.current : !asking ? replyRef.current
      : boardRef.current?.querySelector<HTMLElement>('.hitbox[tabindex="0"]');
    target?.focus({ preventScroll: true });
    // Wait for the dialog's responsive layout: WebKit can focus a newly
    // mounted control before its final position is available for scrolling.
    const frame = requestAnimationFrame(() => {
      if (target === document.activeElement) target?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => {
    if (message && revealFeedbackRef.current) feedbackRef.current?.scrollIntoView({ block: 'nearest' });
    revealFeedbackRef.current = false;
  }, [message]);
  if (!study || !session) return <p role="alert">{prepared.error}</p>;

  function reset(line: number, keepProgress: boolean) {
    if (!study || !session) return;
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
      setSelected(null); setHint(false);
      // The next action can be below the board on a phone. Keep keyboard
      // practice moving through reply/next controls and let focus reveal it.
      focusBoardRef.current = true;
      revealFeedbackRef.current = false;
    }
  }
  const next = nextPracticeLine(study, session, side);
  const nextMove = study.lines[session.line]?.[session.moves.length];
  const completedNotes = complete ? study.notes[session.line] : [];
  const turnMessage = complete ? 'Line complete.' : asking ? `${side === 'w' ? 'Red' : 'Black'} to move.` : 'Play the saved reply to continue.';
  return <div className="study-practice-layout">
    <div className="study-practice-controls">
      <label>Practice as<select className="app-select app-select-roomy" value={side} onChange={event => {
        const chosen = event.target.value as Side;
        setSide(chosen);
        const first = practiceLineIndices(study, chosen)[0];
        if (first !== undefined) setSession(startPracticeLine(study, first));
        setSelected(null); setHint(false); setMessage(''); setNotesOpen(false);
      }}><option value="w">Red</option><option value="b">Black</option></select></label>
      <button type="button" onClick={() => setLetters(value => !value)} aria-pressed={letters}>Letter pieces</button>
    </div>
    {eligible.length === 0 ? <p role="status">This study has no moves for {side === 'w' ? 'Red' : 'Black'}. Choose the other side.</p> : <>
      <div className="study-practice-board" ref={boardRef}>
        <Board board={session.board} orientation={side === 'w' ? 'red' : 'black'} selected={selected} validTargets={validTargets}
          draggableSide={asking ? side : null} onSquareClick={clickSquare} inCheck={isInCheck(session.board, session.side)}
          pieceStyle={letters ? 'letters' : pieceStyle === 'letters' ? 'traditional' : pieceStyle}
          highlights={hint && nextMove ? [uciToSquare(nextMove.slice(0, 2))!, uciToSquare(nextMove.slice(2))!] : []} />
      </div>
      <section className="study-practice-feedback" aria-label="Practice feedback">
        <p role="status" ref={feedbackRef} data-testid="study-practice-status">{message ? `${message} ${turnMessage}` : asking
          ? `${turnMessage} Choose a piece, then its destination. You can also use the board’s arrow keys and Enter.` : turnMessage}</p>
        {hint && nextMove && <p data-testid="study-practice-hint">One saved move: {formatUciMove(nextMove)}</p>}
        <div className="study-practice-actions">
          {asking && <button type="button" onClick={() => { setHint(true); setSession({ ...session, assisted: true }); }}>Show a saved move</button>}
          {!asking && !complete && <button type="button" ref={replyRef} onClick={() => {
            setSession(playPracticeReply(study, session, side)); setSelected(null); setHint(false);
            setMessage(`${session.side === 'w' ? 'Red' : 'Black'} played ${formatUciMove(nextMove)}.`);
            focusBoardRef.current = true;
          }}>Play saved reply</button>}
          {complete && next !== undefined && <button type="button" ref={nextRef} onClick={() => reset(next, true)}>
            {session.completed.filter(line => eligible.includes(line)).length === eligible.length ? 'Practice again' : 'Next line'}
          </button>}
          <button type="button" onClick={() => reset(session.line, true)}>Restart line</button>
        </div>
        <p data-testid="study-practice-progress">{session.completed.filter(line => eligible.includes(line)).length} of {eligible.length} lines practiced</p>
        {session.answered > 0 && <p data-testid="study-practice-recall">{session.recalled} of {session.answered} moves recalled without help</p>}
        {completedNotes.length > 0 && <details className="study-practice-note study-practice-line-notes" data-testid="study-practice-line-notes"
          onToggle={event => setNotesOpen(event.currentTarget.open)}>
          <summary>Study notes for this line ({completedNotes.length})</summary>
          {notesOpen && <ul>{completedNotes.map(note => <li key={note.ply}>
            <strong>{note.move ? `Ply ${note.ply} · ${formatUciMove(note.move)}` : 'Start position'}</strong>
            <p>{note.comment}</p>
          </li>)}</ul>}
        </details>}
        <details className="study-practice-note"><summary>How practice works</summary>
          <p>Recall moves from your saved study. Any stored continuation is accepted; other legal moves may also be good.</p>
          <p>Complete a line to read any notes saved with it.</p>
          <p>Progress lasts for this session. Changing sides starts a new session.</p>
        </details>
      </section>
    </>}
  </div>;
}
