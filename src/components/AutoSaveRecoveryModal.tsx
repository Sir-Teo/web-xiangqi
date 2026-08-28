import { useEffect, useRef } from 'react';
import './AutoSaveRecoveryModal.css';

interface AutoSaveRecoveryModalProps {
    savedAt: number;
    moveCount: number;
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

export function AutoSaveRecoveryModal({ savedAt, moveCount, onRestore, onDismiss }: AutoSaveRecoveryModalProps) {
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
                    {' '}Pick it up where you left off?
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
                        Start fresh
                    </button>
                </div>
            </div>
        </div>
    );
}
