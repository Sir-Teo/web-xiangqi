import { isComposingKey } from '../utils/keyboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Command, rankCommands, readRecentCommandIds, rememberCommandId } from '../utils/commandPalette';
import { MAX_SEARCH_QUERY_LENGTH } from '../utils/searchTerms';
import { keepTabWithin } from '../utils/focusTrap';
import './CommandPaletteModal.css';

interface CommandPaletteModalProps {
    open: boolean;
    commands: Command[];
    onClose: () => void;
}

/**
 * One list, one input, and the arrow keys. Ported from web-chess, which took
 * the shape from web-katrain.
 *
 * A disabled command is shown rather than hidden, with the reason as its hint.
 * A reader looking for "Review game" should find out that it needs moves first,
 * not be left wondering whether they misremembered the name.
 */
export function CommandPaletteModal({ open, commands, onClose }: CommandPaletteModalProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [recentIds, setRecentIds] = useState<string[]>([]);

    useEffect(() => {
        if (!open) return;
        // Where focus was, so it can go back. Closing used to drop it on the
        // body: a reader who opened the palette from the keyboard and pressed
        // Escape lost their place entirely and had to tab in from the start of
        // the page again. The settings and new-game dialogs have always
        // restored it; this one did not.
        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setQuery('');
        setActiveIndex(0);
        setRecentIds(readRecentCommandIds());
        // Focused straight from the effect, the way AutoSaveRecoveryModal does
        // it. A requestAnimationFrame here did not land -- the palette opened
        // with focus still on the body, so the reader had to click the field
        // before typing, which defeats the point of a keyboard shortcut.
        inputRef.current?.focus({ preventScroll: true });
        return () => {
            // Guarded because a command can remove the control it was run from,
            // and because a command that opens another dialog should keep the
            // focus that dialog takes -- React runs this cleanup before that
            // dialog's own effect.
            if (previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, [open]);

    /**
     * Escape is handled on the dialog below, which only sees keys that bubble
     * out of it -- so it stopped working the moment focus was not inside. That
     * is reachable: focus can be blurred to `body` by a click on the palette's
     * own chrome, and a dialog that will not close on Escape and cannot be
     * typed into is a trap with only one way out, the backdrop. The mousedown
     * handler below keeps focus in the field; this makes Escape true whether
     * it does or not.
     */
    useEffect(() => {
        if (!open) return undefined;
        const onEscape = (event: KeyboardEvent) => {
            if (isComposingKey(event)) return;
            keepTabWithin(dialogRef.current, event);
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            onClose();
        };
        document.addEventListener('keydown', onEscape);
        return () => document.removeEventListener('keydown', onEscape);
    }, [open, onClose]);

    const ranked = useMemo(() => rankCommands(commands, query, recentIds), [commands, query, recentIds]);

    // The query changing can leave the highlight past the end of a shorter list.
    useEffect(() => {
        setActiveIndex((index) => (index >= ranked.length ? 0 : index));
    }, [ranked.length]);

    useEffect(() => {
        if (!open) return;
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, open, ranked]);

    if (!open) return null;
    const activeCommand = ranked[activeIndex];

    const runCommand = (command: Command | undefined) => {
        if (!command || command.disabled) return;
        setRecentIds(rememberCommandId(command.id));
        onClose();
        command.run();
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (isComposingKey(event.nativeEvent)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (ranked.length === 0) return;
        // Arrow navigation uses aria-activedescendant on the search field.
        // Leave a tabbed-to button before changing the highlighted command.
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            inputRef.current?.focus({ preventScroll: true });
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % ranked.length);
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + ranked.length) % ranked.length);
        }
        if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); }
        if (event.key === 'End') { event.preventDefault(); setActiveIndex(ranked.length - 1); }
        if (event.key === 'Enter') {
            // A hovered row can differ from the keyboard-focused button.
            // Let that button's native activation run its own onClick.
            if (event.target instanceof HTMLButtonElement) return;
            event.preventDefault();
            runCommand(ranked[activeIndex]);
        }
    };

    return (
        <div className="command-palette-backdrop" onClick={onClose} data-command-palette="true">
            <div
                className="command-palette-modal"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Commands"
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => {
                    // A click on the palette's own chrome -- the count line,
                    // the padding, the gap beside a row -- is a click on
                    // something unfocusable, which blurs the field to `body`.
                    // The palette stayed open and went deaf: nothing to type
                    // into, and its key handling reaches nothing from `body`.
                    // Hold the focus rather than chase it back afterwards.
                    if (event.target instanceof HTMLElement
                        && event.target.closest('input, button, [role="option"]')) return;
                    event.preventDefault();
                }}
                onKeyDown={onKeyDown}
            >
                {/*
                  * aria-expanded and aria-controls follow the list rather than
                  * assert it. The listbox is not rendered at all when nothing
                  * matches, so a fixed aria-expanded="true" told a screen
                  * reader a popup was open and aria-controls named an element
                  * that had left the document -- while the live region below it
                  * said "No commands match". The activedescendant already took
                  * care to go undefined in that state; these two did not.
                  */}
                <input
                    ref={inputRef}
                    data-command-input
                    className="command-palette-input"
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={ranked.length > 0}
                    aria-controls={ranked.length > 0 ? "command-palette-list" : undefined}
                    aria-activedescendant={ranked[activeIndex] ? `command-${ranked[activeIndex].id}` : undefined}
                    aria-label="Search commands"
                    autoComplete="off"
                    placeholder="Type a command…"
                    maxLength={MAX_SEARCH_QUERY_LENGTH}
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                />

                {/*
                  * Announced politely, the way web-katrain's palette does it.
                  * Without this a screen-reader user types and hears nothing:
                  * the list narrowing, or emptying, is invisible unless the
                  * count is spoken.
                  */}
                <p className="command-palette-count" aria-live="polite" data-command-count>
                    {ranked.length === 0
                        ? 'No commands match'
                        : `${ranked.length} command${ranked.length === 1 ? '' : 's'}`}
                </p>

                {ranked.length > 0 && (
                    <ul className="command-palette-list" id="command-palette-list" role="listbox" ref={listRef}>
                        {ranked.map((command, index) => (
                            <li
                                key={command.id}
                                id={`command-${command.id}`}
                                role="option"
                                aria-selected={index === activeIndex}
                                aria-disabled={command.disabled || undefined}
                                data-active={index === activeIndex}
                                data-command-id={command.id}
                                className="command-palette-row"
                                onPointerDown={() => setActiveIndex(index)}
                                // Filtering can move a row under a stationary
                                // pointer. Only actual movement changes hover selection.
                                onPointerMove={() => setActiveIndex(index)}
                            >
                                <button
                                    type="button"
                                    className="command-palette-button"
                                    disabled={command.disabled}
                                    onFocus={() => setActiveIndex(index)}
                                    onClick={() => runCommand(command)}
                                >
                                    <span className="command-palette-label">{command.label}</span>
                                    {command.hint && (
                                        // Titled because the hint is the reason a
                                        // command is unavailable, and it is the first
                                        // thing to be truncated at phone width.
                                        <span className="command-palette-hint" title={command.hint}>{command.hint}</span>
                                    )}
                                    {command.shortcut && <kbd className="command-palette-key">{command.shortcut}</kbd>}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="command-palette-help" data-testid="command-palette-help">
                    {activeCommand?.hint || (ranked.length
                        ? 'Use ↑ and ↓ to choose, Enter to run, or Escape to close.'
                        : 'Try fewer words or search for an action such as “Flip” or “Settings”.')}
                </p>
            </div>
        </div>
    );
}
