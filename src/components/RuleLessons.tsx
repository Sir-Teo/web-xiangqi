import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Board } from './Board/Board';
import { keepTabWithin } from '../utils/focusTrap';
import { isComposingKey } from '../utils/keyboard';
import { RULE_LESSONS, attemptRuleLesson, completeRuleLesson, readRuleLessonProgress, saveRuleLessonProgress } from '../utils/ruleLessons';
import { isRedPiece, legalMovesFrom, parseFenBoard, squareToUci, uciToSquare } from '../utils/xiangqi';
import './RuleLessons.css';
import { IconX } from './icons';
import type { PieceStyle } from '../utils/pieceStyle';

export function RuleLessons({ onClose, pieceStyle = 'traditional' }: { onClose: () => void; pieceStyle?: PieceStyle }) {
    const [completed, setCompleted] = useState(readRuleLessonProgress);
    const [index, setIndex] = useState(() => Math.max(0, RULE_LESSONS.findIndex(lesson => !completed.includes(lesson.id))));
    const lesson = RULE_LESSONS[index];
    const [board, setBoard] = useState(() => parseFenBoard(lesson.fen));
    const [selected, setSelected] = useState(() => uciToSquare(lesson.solution.slice(0, 2)));
    const [solved, setSolved] = useState(false);
    const [hint, setHint] = useState(false);
    const [message, setMessage] = useState('');
    const [saveState, setSaveState] = useState<'failed' | 'retry-failed' | 'saved' | null>(null);
    const [letters, setLetters] = useState(pieceStyle === 'letters');
    const dialog = useRef<HTMLDivElement>(null);
    const feedback = useRef<HTMLParagraphElement>(null);
    const feedbackId = useId();
    const nextLessonRef = useRef<HTMLButtonElement>(null);
    const returnRef = useRef<HTMLButtonElement>(null);
    const validTargets = useMemo(() => selected && !solved ? legalMovesFrom(board, selected.file, selected.rank, 'w') : [], [board, selected, solved]);

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.current?.querySelector<HTMLButtonElement>('header button')?.focus({ preventScroll: true });
        return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
    }, []);
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (isComposingKey(event)) return;
            keepTabWithin(dialog.current, event);
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        };
        window.addEventListener('keydown', keydown, true);
        return () => window.removeEventListener('keydown', keydown, true);
    }, [onClose]);
    useEffect(() => {
        // On short phones feedback sits below the board. Reveal the outcome so
        // a learner never has to guess whether a tap worked.
        if (message || hint) feedback.current?.scrollIntoView({ block: 'nearest' });
    }, [message, hint]);

    function openLesson(next: number) {
        setIndex(next); setBoard(parseFenBoard(RULE_LESSONS[next].fen));
        setSelected(uciToSquare(RULE_LESSONS[next].solution.slice(0, 2))); setSolved(false); setHint(false); setMessage('');
        dialog.current?.querySelector<HTMLSelectElement>('select')?.focus();
    }
    function clickSquare(file: number, rank: number) {
        if (solved) return;
        if (isRedPiece(board[rank][file])) { setSelected({ file, rank }); setMessage(''); return; }
        if (!selected) { setMessage('Select a red piece first.'); return; }
        const attempt = attemptRuleLesson(lesson, squareToUci(selected.file, selected.rank) + squareToUci(file, rank));
        setMessage(attempt.message);
        if (attempt.solved) {
            setBoard(attempt.board); setSelected(null); setSolved(true);
            const progress = completeRuleLesson(lesson.id, completed);
            setCompleted(progress.completed); setSaveState(progress.saved ? null : 'failed');
        }
    }
    return <>
        <div className="rule-lessons-backdrop" onClick={onClose} aria-hidden="true" />
        <div className="rule-lessons" role="dialog" aria-modal="true" aria-labelledby="rule-lessons-title" ref={dialog} data-testid="rule-lessons">
            <header><div><h2 id="rule-lessons-title">Learn the rules</h2><span data-testid="lesson-progress">{completed.length} of {RULE_LESSONS.length} completed</span></div>
                <button type="button" onClick={onClose} aria-label="Close rule lessons"><IconX width={18} height={18} /></button></header>
            <div className="rule-lessons-layout">
                <div className="rule-lessons-intro">
                    <label>Choose a lesson<select className="app-select app-select-roomy" value={index} onChange={event => openLesson(Number(event.target.value))} data-testid="lesson-select">
                        {RULE_LESSONS.map((item, i) => <option key={item.id} value={i}>{completed.includes(item.id) ? '✓ ' : ''}{i + 1}. {item.title}</option>)}
                    </select></label>
                    <h3>{lesson.title}</h3>
                    <p>{lesson.rule}</p><p className="rule-lessons-task">{lesson.task}</p>
                </div>
                <div className="rule-lessons-board"><Board key={lesson.id} board={board} selected={selected} validTargets={validTargets} onSquareClick={clickSquare}
                    draggableSide={solved ? null : 'w'} pieceStyle={letters ? 'letters' : 'traditional'}
                    highlights={hint && !solved ? [uciToSquare(lesson.solution.slice(2))!] : []} /></div>
                <section className="rule-lessons-content" aria-label="Exercise feedback">
                    <p className="rule-lessons-feedback" id={feedbackId} role="status" aria-atomic="true" data-solved={solved} data-testid="lesson-feedback" ref={feedback}>
                        {message || 'The exercise piece is selected. Tap a target, or use arrow keys and Enter on the board.'}
                        {hint && !solved && <span className="rule-lessons-hint"> Hint: {lesson.hint}</span>}
                    </p>
                    {saveState && <div className="rule-lessons-save-notice" data-testid="lesson-progress-save">
                        <p role={saveState === 'saved' ? 'status' : 'alert'}>{saveState === 'saved'
                            ? 'Lesson progress saved in this browser.' : saveState === 'retry-failed'
                                ? 'Browser storage still could not save your progress. Your completed lessons remain here.'
                                : 'Completed here, but browser storage could not save your progress.'}</p>
                        {saveState !== 'saved' && <button type="button" onClick={event => {
                            const progress = saveRuleLessonProgress(completed);
                            setCompleted(progress.completed); setSaveState(progress.saved ? 'saved' : 'retry-failed');
                            if (progress.saved && document.activeElement === event.currentTarget) {
                                const target = solved ? nextLessonRef.current ?? returnRef.current
                                    : dialog.current?.querySelector<HTMLButtonElement>('.hitbox[tabindex="0"]');
                                target?.focus({ preventScroll: true });
                                requestAnimationFrame(() => { if (target === document.activeElement) target?.scrollIntoView({ block: 'nearest' }); });
                            }
                        }}>Retry saving progress</button>}
                    </div>}
                    <div className="rule-lessons-actions">
                        <button type="button" onClick={() => setLetters(value => !value)} aria-pressed={letters}>Letter pieces</button>
                        {!solved && <button type="button" aria-expanded={hint} aria-controls={feedbackId} onClick={() => setHint(value => !value)}>{hint ? 'Hide hint' : 'Show hint'}</button>}
                        <button type="button" onClick={() => openLesson(index)}>Try again</button>
                        {solved && index < RULE_LESSONS.length - 1 && <button type="button" ref={nextLessonRef} onClick={() => openLesson(index + 1)}>Next lesson</button>}
                    </div>
                    {completed.length === RULE_LESSONS.length && <p>You have completed all nine exercises. Revisit any lesson to practice again.</p>}
                    <button type="button" className="rule-lessons-return" ref={returnRef} onClick={onClose}>Back to your board</button>
                </section>
            </div>
        </div>
    </>;
}
