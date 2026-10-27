/** Shared keyboard focus handling for the app's dialogs. */
import { isComposingKey } from './keyboard';

/** Keep the beginning of a long dialog and its initial focus in view. */
export function focusDialogStart(
    container: HTMLElement | null,
    primaryAction: HTMLElement | null,
    heading: HTMLElement | null,
): void {
    if (!container) return;
    const target = container.scrollHeight > container.clientHeight + 1 ? heading : primaryAction;
    target?.focus({ preventScroll: true });
}

/** Candidate controls; visibility and actual tab stops are checked below. */
export const DIALOG_FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    'summary',
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
            if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[inert]')) return false;
            // Recent Chromium can expose layout boxes inside a closed details
            // element. Such controls still cannot receive focus. Use the native
            // ancestor visibility check where available, then the geometry and
            // CSS checks for browsers without it.
            if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) return false;
            if (!element.getClientRects().length) return false;
            const style = window.getComputedStyle(element);
            return style.visibility !== 'hidden' && style.visibility !== 'collapse';
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
    // Option+Tab remains available for macOS full keyboard navigation.
    if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || isComposingKey(event) || !container) return;
    const focusable = getDialogFocusableElements(container);
    if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    // A long dialog initially focuses its title (tabindex=-1). Treat that as
    // the start of the cycle too, so Shift+Tab cannot escape into the page.
    const outsideTabOrder = !focusable.some(element => element === active);
    if (event.shiftKey && (outsideTabOrder || active === first)) {
        event.preventDefault();
        // Focus can leave a control partly clipped in a scrolling dialog.
        last.focus();
        last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (!event.shiftKey && (outsideTabOrder || active === last)) {
        event.preventDefault();
        first.focus();
        first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}
