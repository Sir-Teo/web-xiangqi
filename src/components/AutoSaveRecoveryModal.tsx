import type { RecoveryDraft } from '../utils/autoSaveDrafts';
import { useEffect, useRef } from 'react';
import './AutoSaveRecoveryModal.css';
import { focusDialogStart, keepTabWithin } from '../utils/focusTrap';
import { isComposingKey } from '../utils/keyboard';

interface AutoSaveRecoveryModalProps {
    drafts?: RecoveryDraft[];
    draftId?: string;
    onSelectDraft?: (id: string) => void;
    error?: string | null;
    onDownload?: () => void;
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
    onLater: () => void;
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

function draftLabel(draft: RecoveryDraft): string {
    const { game } = draft;
    return game.label || game.metadata?.event
        || [game.metadata?.redPlayer, game.metadata?.blackPlayer].filter(Boolean).join(' · ')
        || game.opening || 'Unfinished study';
}

export function AutoSaveRecoveryModal({
    drafts = [], draftId, onSelectDraft, error, onDownload,
    savedAt,
    moveCount,
    incomingLink = null,
    onRestore,
    onDismiss,
    onLater,
}: AutoSaveRecoveryModalProps) {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
    const titleRef = useRef<HTMLHeadingElement | null>(null);
    const selectedDraft = drafts.find(draft => draft.draftId === draftId) ?? drafts[0];

    useEffect(() => {
        focusDialogStart(modalRef.current, primaryButtonRef.current, titleRef.current);
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isComposingKey(event)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                onLater();
                return;
            }
            keepTabWithin(modalRef.current, event);
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onLater]);

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
                <h2 className="auto-save-title" id="auto-save-title" ref={titleRef} tabIndex={-1}>Unfinished game</h2>
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
                {error && <p role="alert">{error}</p>}
                {error && onDownload && <button className="auto-save-btn auto-save-btn-secondary" type="button" onClick={onDownload}>Download original data</button>}
                {drafts.length > 1 && <>
                    <label className="auto-save-draft-picker">Recovery draft
                        <select className="app-select app-select-roomy" value={draftId} aria-describedby="auto-save-draft-details" onChange={event => onSelectDraft?.(event.target.value)}>
                            {drafts.map(draft => <option key={draft.draftId} value={draft.draftId}>
                                {draftLabel(draft)} · {draft.game.moves.length} {draft.game.moves.length === 1 ? 'move' : 'moves'} · {new Date(draft.savedAt).toLocaleString()}
                            </option>)}
                        </select>
                    </label>
                    <p id="auto-save-draft-details" className="auto-save-draft-details">{selectedDraft && draftLabel(selectedDraft)}</p>
                </>}
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
                    <button className="auto-save-btn auto-save-btn-secondary" type="button" onClick={onLater}>Decide later</button>
                </div>
            </div>
        </div>
    );
}
