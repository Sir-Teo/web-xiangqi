/**
 * Keeping Tab inside a dialog, written once.
 *
 * There were three of these: one in `App.tsx` for the settings and new-game
 * dialogs, and a hand-rolled copy in each of the game-over and auto-save
 * modals. They had already drifted — the copies looked only at
 * `button:not(:disabled)`, so a dialog that ever grew a link, an input or a
 * button hidden by CSS rather than unmounted would have cycled through the
 * wrong set and dropped focus at the wrong edge. Neither modal holds anything
 * but two buttons today, so this changes no behaviour; it removes the way it
 * would have gone wrong quietly.
 */

/** Everything the browser will hand a Tab press, disabled controls aside. */
export const DIALOG_FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The focusable elements of `container`, in tab order, minus the ones the
 * browser will skip. A `display: none` or `visibility: hidden` control still
 * matches the selector and still cannot take focus, so leaving it in makes the
 * first or last element of the cycle a dead stop.
 */
export function getDialogFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
        .filter((element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
}

/**
 * Handle a Tab press so focus stays inside `container`. Call it from a keydown
 * listener; it does nothing unless the key is Tab.
 *
 * Focus that is *outside* the dialog is pulled back to whichever end the press
 * was heading for, which is what makes this a trap rather than a wrap: a click
 * on the dialog's own non-focusable chrome blurs to `body`, and without this
 * the next Tab would walk into the page behind.
 */
export function keepTabWithin(container: HTMLElement | null, event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !container) return;
    const focusable = getDialogFocusableElements(container);
    if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const outside = !active || !container.contains(active);
    if (event.shiftKey && (outside || active === first)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
    }
}
