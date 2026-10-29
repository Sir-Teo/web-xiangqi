import { useEffect, type RefObject } from 'react';
import { getDialogFocusableElements, keepTabWithin } from '../utils/focusTrap';

/** Focus the mounted dialog, trap Tab and restore its launcher on close. */
export function useDialogFocus(dialog: RefObject<HTMLDivElement>, enabled = true) {
  useEffect(() => {
    const activeDialog = enabled ? dialog.current : null;
    if (!activeDialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    let initialFocusPlaced = false;
    const focusInitial = () => {
      if (initialFocusPlaced) return;
      if (activeDialog.contains(document.activeElement)) { initialFocusPlaced = true; return; }
      const firstFocusable = getDialogFocusableElements(activeDialog)[0];
      (firstFocusable ?? activeDialog).focus({ preventScroll: true });
      // Retry only a focus attempt that failed, for example while the page's
      // inert state settles. A later disabled action can legitimately blur to
      // body; an initial-focus retry must not take over that interaction.
      initialFocusPlaced = activeDialog.contains(document.activeElement);
    };

    focusInitial();
    const frame = window.requestAnimationFrame(focusInitial);
    const retryTimer = window.setTimeout(focusInitial, 80);
    const onDialogKeyDown = (event: KeyboardEvent) => keepTabWithin(activeDialog, event);

    document.addEventListener('keydown', onDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryTimer);
      document.removeEventListener('keydown', onDialogKeyDown);
      // Never `body`: inerting the page behind a dialog blurs the launcher, so
      // this can have captured `body`, and focusing it would undo the give-back
      // the inert effect already did.
      if (previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [dialog, enabled]);
}
