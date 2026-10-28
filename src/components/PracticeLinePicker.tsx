import { useId, useRef, useState } from 'react';

/** Keep unfinished input local so typing does not redraw the practice board. */
export function PracticeLinePicker({ current, total, onStart }: {
  current: number; total: number; onStart: (ordinal: number) => void;
}) {
  const [choice, setChoice] = useState(String(current));
  const details = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const helpId = useId();
  return <details className="study-practice-note study-practice-line-picker" ref={details}>
    <summary>Choose a line</summary>
    <form onSubmit={event => {
      event.preventDefault();
      const ordinal = Number(choice);
      if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > total) {
        input.current?.reportValidity();
        return;
      }
      setChoice(String(ordinal));
      if (details.current) details.current.open = false;
      onStart(ordinal);
    }}>
      <label>Line number<input ref={input} type="number" inputMode="numeric" min={1} max={total} step={1}
        required value={choice} aria-describedby={helpId} onChange={event => setChoice(event.target.value)} /></label>
      <button type="submit">Start line</button>
      <p id={helpId}>Choose 1 to {total}. Scores and completed lines are kept.</p>
    </form>
  </details>;
}
