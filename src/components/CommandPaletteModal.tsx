import { useEffect, useMemo, useRef, useState } from 'react';
import { type Command, rankCommands, readRecentCommandIds, rememberCommandId } from '../utils/commandPalette';
import { MAX_SEARCH_QUERY_LENGTH } from '../utils/searchTerms';
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
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [recentIds, setRecentIds] = useState<string[]>([]);

    useEffect(() => {
        if (!open) return;
        setQuery('');
        setActiveIndex(0);
        setRecentIds(readRecentCommandIds());
        // Focused straight from the effect, the way AutoSaveRecoveryModal does
        // it. A requestAnimationFrame here did not land -- the palette opened
        // with focus still on the body, so the reader had to click the field
        // before typing, which defeats the point of a keyboard shortcut.
        inputRef.current?.focus({ preventScroll: true });
    }, [open]);

    const ranked = useMemo(() => rankCommands(commands, query, recentIds), [commands, query, recentIds]);

    // The query changing can leave the highlight past the end of a shorter list.
    useEffect(() => {
        setActiveIndex((index) => (index >= ranked.length ? 0 : index));
    }, [ranked.length]);

    useEffect(() => {
        if (!open) return;
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, open]);

    if (!open) return null;

    const runCommand = (command: Command | undefined) => {
        if (!command || command.disabled) return;
        setRecentIds(rememberCommandId(command.id));
        onClose();
        command.run();
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (ranked.length === 0) return;
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
            event.preventDefault();
            runCommand(ranked[activeIndex]);
        }
    };

    return (
        <div className="command-palette-backdrop" onClick={onClose} data-command-palette="true">
            <div
                className="command-palette-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Commands"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={onKeyDown}
            >
                <input
                    ref={inputRef}
                    data-command-input
                    className="command-palette-input"
                    type="text"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="command-palette-list"
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
                            >
                                <button
                                    type="button"
                                    className="command-palette-button"
                                    disabled={command.disabled}
                                    onMouseEnter={() => setActiveIndex(index)}
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
            </div>
        </div>
    );
}
