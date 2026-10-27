import { isComposingKey } from '../../utils/keyboard';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
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
    const focusedMoveRef = useRef<HTMLButtonElement | null>(null);
    const stopIndex = rovingTabStopIndex(tokens.length, rovingIndex, 0);

    useLayoutEffect(() => {
        const previous = focusedMoveRef.current;
        if (!previous || previous.isConnected) return;
        focusedMoveRef.current = null;
        // A shorter live line can remove the focused move. Continue at its
        // nearest remaining move, provided focus has not moved elsewhere.
        if (!tokens.length || document.activeElement !== document.body) return;
        const index = Math.min(Number(previous.dataset.moveIndex), tokens.length - 1);
        const target = stripRef.current?.querySelectorAll<HTMLButtonElement>('button[data-move-index]')[index];
        target?.focus({ preventScroll: true });
        const frame = requestAnimationFrame(() => {
            if (target === document.activeElement) target?.scrollIntoView({ block: 'nearest' });
        });
        return () => cancelAnimationFrame(frame);
    }, [tokens.length]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLSpanElement>) => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isComposingKey(event.nativeEvent)) return;
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
            {/* Keep focus on a move’s place when live analysis changes its text. */}
            {tokens.map((token, moveIndex) => (
                <button
                    key={moveIndex}
                    type="button"
                    className="pv-move-btn"
                    data-move-index={moveIndex}
                    tabIndex={moveIndex === stopIndex ? 0 : -1}
                    onClick={() => onPlay(moveIndex + 1)}
                    onFocus={event => { focusedMoveRef.current = event.currentTarget; setRovingIndex(moveIndex); }}
                    onBlur={event => { if (event.currentTarget.isConnected) focusedMoveRef.current = null; }}
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
