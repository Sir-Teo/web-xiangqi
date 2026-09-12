import { useLayoutEffect, useRef } from 'react';
import './StudyMainLineControls.css';

type Props = {
    pinned: boolean;
    viewingMainLine: boolean;
    disabled: boolean;
    onPin: () => void;
    onOpen: () => void;
    onUnpin: () => void;
};

export function StudyMainLineControls({ pinned, viewingMainLine, disabled, onPin, onOpen, onUnpin }: Props) {
    const summaryRef = useRef<HTMLElement>(null);
    const pendingActionRef = useRef<HTMLButtonElement | null>(null);
    const activate = (button: HTMLButtonElement, action: () => void) => {
        pendingActionRef.current = document.activeElement === button ? button : null;
        action();
    };
    useLayoutEffect(() => {
        const previous = pendingActionRef.current;
        pendingActionRef.current = null;
        if (!previous || (!previous.disabled && previous.isConnected)) return;
        if (document.activeElement === previous || document.activeElement === document.body) {
            const summary = summaryRef.current;
            summary?.focus({ preventScroll: true });
            const frame = requestAnimationFrame(() => {
                if (summary === document.activeElement) summary?.scrollIntoView({ block: 'nearest' });
            });
            return () => cancelAnimationFrame(frame);
        }
    }, [disabled, pinned, viewingMainLine]);
    return <details className="study-main-line" data-testid="study-main-line">
        <summary ref={summaryRef}>{pinned ? 'Study main line set' : 'Choose a study main line'}</summary>
        <p role="status">{pinned
            ? `${viewingMainLine ? 'Viewing the main line.' : 'Exploring a variation.'} Your main line stays fixed in saved studies and PGN.`
            : 'Set the line shown above as your main line. You can explore other variations without changing it.'}</p>
        <div className="study-main-line-actions">
            <button type="button" className="chip-btn" disabled={disabled || viewingMainLine} onClick={event => activate(event.currentTarget, onPin)}
                data-testid="pin-study-main-line">Set this as main line</button>
            {pinned && <>
                <button type="button" className="chip-btn" disabled={disabled || viewingMainLine} onClick={event => activate(event.currentTarget, onOpen)}
                    data-testid="open-study-main-line">Go to main line</button>
                <button type="button" className="chip-btn" disabled={disabled} onClick={event => activate(event.currentTarget, onUnpin)}
                    data-testid="unpin-study-main-line" title="Let PGN export follow whichever line you are viewing">Follow selection instead</button>
            </>}
        </div>
    </details>;
}
