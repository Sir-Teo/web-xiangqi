import { useEffect, useRef } from 'react';
import './AutoSaveRecoveryModal.css';

interface AutoSaveRecoveryModalProps {
    savedAt: number;
    moveCount: number;
    /**
     * The game the address bar carried in, if it carried one.
     *
     * A reader who has just clicked a shared analysis link is in a different
     * situation from one opening the site cold, and the dismiss button means
     * something different to each. Cold, it starts an empty board -- "Start
     * fresh" is exactly right. Following a link, the link's game is *already*
     * on the board, so "Start fresh" is the button that keeps it and "Restore"
     * is the button that throws it away. The label said the opposite of what
     * it did, so the reader who wanted the link had every reason to pick the
     * button that discarded it.
     */
    incomingLink?: { moveCount: number } | null;
    onRestore: () => void;
    onDismiss: () => void;
}

function describeWhen(savedAt: number, now = Date.now()): string {
    const elapsedMs = now - savedAt;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'recently';
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 1) return 'moments ago';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function AutoSaveRecoveryModal({
    savedAt,
    moveCount,
    incomingLink = null,
    onRestore,
    onDismiss,
}: AutoSaveRecoveryModalProps) {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const primaryButtonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        primaryButtonRef.current?.focus({ preventScroll: true });

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onDismiss();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = Array.from(
                modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []
            );
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;

            if (!active || !modalRef.current?.contains(active)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onDismiss]);

    return (
        <div className="auto-save-backdrop">
            <div
                className="auto-save-modal"
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="auto-save-title"
                aria-describedby="auto-save-subtitle"
            >
                <h2 className="auto-save-title" id="auto-save-title">Unfinished game</h2>
                <p className="auto-save-subtitle" id="auto-save-subtitle">
                    {moveCount > 0
                        ? `${moveCount} ${moveCount === 1 ? 'move was' : 'moves were'} in progress ${describeWhen(savedAt)}.`
                        : `A position was in progress ${describeWhen(savedAt)}.`}
                    {' '}
                    {incomingLink
                        ? `Restoring it replaces ${incomingLink.moveCount > 0
                            ? `the ${incomingLink.moveCount}-move game`
                            : 'the position'} this link opened.`
                        : 'Pick it up where you left off?'}
                </p>
                <div className="auto-save-actions">
                    <button
                        className="auto-save-btn auto-save-btn-primary"
                        type="button"
                        onClick={onRestore}
                        ref={primaryButtonRef}
                    >
                        Restore
                    </button>
                    <button
                        className="auto-save-btn auto-save-btn-secondary"
                        type="button"
                        onClick={onDismiss}
                    >
                        {incomingLink ? "Keep the link's game" : 'Start fresh'}
                    </button>
                </div>
            </div>
        </div>
    );
}
