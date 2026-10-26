import './BeginnerGuide.css';
import { IconX } from './icons';

export function BeginnerGuide({ letters, compact, onToggleLetters, onPlay, onImport, onLibrary, onLearn, onDismiss }: {
  letters: boolean;
  compact: boolean;
  onToggleLetters: () => void;
  onPlay: () => void;
  onImport: () => void;
  onLibrary: () => void;
  onLearn: () => void;
  onDismiss: () => void;
}) {
  const content = (
    <>
      <div className="beginner-guide-heading">
        <strong>Play, learn, or study</strong>
        <button type="button" onClick={onDismiss} aria-label="Dismiss first-move guide"><IconX width={18} height={18} /></button>
      </div>
      <p>Move either side to explore, play the computer, or import a game to study.</p>
      <div className="beginner-guide-actions">

        <button type="button" className="chip-btn" onClick={onPlay}>Play Beginner</button>
        <button type="button" className="chip-btn" onClick={onImport}>Import a game</button>
        <button type="button" className="chip-btn" onClick={onLibrary}>Open library</button>
        <button type="button" className="chip-btn" onClick={event => { event.currentTarget.focus(); onLearn(); }}>Learn the rules</button>
        <button type="button" className="chip-btn" onClick={onToggleLetters} aria-pressed={letters}>Letter pieces</button>
      </div>
      <p>Select a red piece, then a highlighted point to move. Engine analysis starts when you request it.</p>
    </>
  );
  return (
    <section className="beginner-guide" aria-label="Your first move" data-testid="beginner-guide">
      {compact ? <details><summary>Play, learn, or study — choose a task</summary>{content}</details> : content}
    </section>
  );
}
