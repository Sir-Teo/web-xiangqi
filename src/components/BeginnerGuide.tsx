import './BeginnerGuide.css';

export function BeginnerGuide({ letters, compact, onToggleLetters, onPlay, onDismiss }: {
  letters: boolean;
  compact: boolean;
  onToggleLetters: () => void;
  onPlay: () => void;
  onDismiss: () => void;
}) {
  const content = (
    <>
      <div className="beginner-guide-heading">
        <strong>Your first move</strong>
        <button type="button" onClick={onDismiss} aria-label="Dismiss first-move guide">×</button>
      </div>
      <p>Select a red piece, then a highlighted point to move. Select a piece to see how it moves.</p>
      <div className="beginner-guide-actions">
        <button type="button" className="chip-btn" onClick={onToggleLetters} aria-pressed={letters}>Letter pieces</button>
        <button type="button" className="chip-btn" onClick={onPlay}>Play Beginner</button>
      </div>
    </>
  );
  return (
    <section className="beginner-guide" aria-label="Your first move" data-testid="beginner-guide">
      {compact ? <details><summary>First move? Tap for help</summary>{content}</details> : content}
    </section>
  );
}
