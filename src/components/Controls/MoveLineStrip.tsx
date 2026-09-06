import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { rovingIndexForKey, rovingTabStopIndex } from '../../utils/rovingFocus';

/**
 * A line of moves, each a button that plays the line up to it, presented to
 * the keyboard as one tab stop.
 *
 * The engine tab shows three lines of ten moves and the cloud card another
 * ten; as plain buttons that was forty tab stops between the line controls
 * and the actions under them, on a page whose tab order is a budget (see
 * "The tab order is a budget" in the architecture notes). One stop per line,
 * Left and Right along it, Home and End to its ends: the same shape as the
 * breadcrumb, which `utils/rovingFocus` already does the arithmetic for.
 *
 * The stop follows focus, then falls back to the first move, which is the
 * one a keyboard reader most often wants. Ends do not wrap.
 */
export interface MoveLineStripProps {
    tokens: string[];
    /** Moves past the ones shown, printed as "+n" after the last button. */
    remaining: number;
    disabled?: boolean;
    onPlay: (count: number) => void;
    ariaLabel: (index: number, token: string) => string;
    title: (index: number, token: string) => string;
    testId: (index: number) => string;
    /** Shown instead of buttons when there are no moves. */
    emptyText?: string;
}

export function MoveLineStrip({
    tokens,
    remaining,
    disabled = false,
    onPlay,
    ariaLabel,
    title,
    testId,
    emptyText,
}: MoveLineStripProps) {
    const [rovingIndex, setRovingIndex] = useState<number | null>(null);
    const stripRef = useRef<HTMLSpanElement | null>(null);
    const stopIndex = rovingTabStopIndex(tokens.length, rovingIndex, 0);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLSpanElement>) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        const from = Number(target.dataset.moveIndex);
        if (!Number.isInteger(from)) return;
        const next = rovingIndexForKey(event.key, tokens.length, from);
        if (next === null) return;
        event.preventDefault();
        setRovingIndex(next);
        const buttons = stripRef.current?.querySelectorAll<HTMLButtonElement>('button[data-move-index]');
        buttons?.[next]?.focus();
    }, [tokens.length]);

    if (tokens.length === 0) {
        return emptyText ? <>{emptyText}</> : null;
    }

    return (
        <span className="pv-move-strip" ref={stripRef} onKeyDown={handleKeyDown}>
            {tokens.map((token, moveIndex) => (
                <button
                    key={`${moveIndex}-${token}`}
                    type="button"
                    className="pv-move-btn"
                    data-move-index={moveIndex}
                    tabIndex={moveIndex === stopIndex ? 0 : -1}
                    onClick={() => onPlay(moveIndex + 1)}
                    onFocus={() => setRovingIndex(moveIndex)}
                    disabled={disabled}
                    title={title(moveIndex, token)}
                    aria-label={ariaLabel(moveIndex, token)}
                    aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                    data-testid={testId(moveIndex)}
                >
                    {token}
                </button>
            ))}
            {remaining > 0 ? <span className="pv-move-rest">+{remaining}</span> : null}
        </span>
    );
}
