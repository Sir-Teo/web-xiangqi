/**
 * How wide the side panels are, and what the keyboard does to them.
 *
 * Three small functions with three non-obvious rules between them, all of which
 * were learned from a defect and none of which had a test. `initialPanelWidth`
 * was one of the three helpers `docs/architecture.md` named as deserving one.
 */

export const PANEL_MIN_WIDTH = 60;
export const PANEL_MAX_WIDTH = 600;
export const PANEL_KEYBOARD_STEP = 40;
export const DEFAULT_PANEL_WIDTH = 320;

/**
 * The width a panel opens at on this window.
 *
 * 320px each is right on a wide screen and much too much on a narrow one: at
 * 920px the two panels take 640px and leave the board 248px, smaller than
 * either of them. The CSS already claws back what it can in that band -- it
 * drops the stage padding and hides the capture trays -- but the panel widths
 * live here, so the starting width scales to the window. Dragging is untouched
 * and still reaches `PANEL_MAX_WIDTH`.
 */
export function initialPanelWidth(fallback: number, viewportWidth?: number): number {
    const width = viewportWidth ?? (typeof window === 'undefined' ? undefined : window.innerWidth);
    // A window that reports no width -- a tab rendered before it is shown, an
    // embedded pane -- is not a narrow one. Sizing to it collapsed both panels
    // to the minimum until the next resize event, which does not always come.
    if (width === undefined || !Number.isFinite(width) || width <= 0) return fallback;
    return Math.max(PANEL_MIN_WIDTH, Math.min(fallback, Math.round(width * 0.26)));
}

/**
 * A dragged or stepped width, held inside what a panel may be.
 *
 * Below the minimum it returns **0**, not the minimum: a panel narrower than
 * `PANEL_MIN_WIDTH` is one the user is closing, and snapping it back open would
 * make it impossible to close by dragging.
 */
export function clampPanelWidth(width: number): number {
    const nextWidth = Math.round(width);
    if (nextWidth < PANEL_MIN_WIDTH) return 0;
    return Math.min(nextWidth, PANEL_MAX_WIDTH);
}

/**
 * One keyboard step, which is not symmetric and must not be.
 *
 * Growing from collapsed resumes at `fallback`, because stepping 0 -> 40 lands
 * under `PANEL_MIN_WIDTH` and `clampPanelWidth` sends it straight back to 0 --
 * so the widen key would do nothing at all on a closed panel.
 *
 * Shrinking must *not* borrow that fallback. It did, and the narrow key reopened
 * a closed panel to 280, so a keyboard user could never come to rest on
 * collapsed.
 */
export function stepPanelWidth(width: number, delta: number, fallback: number): number {
    if (width <= 0 && delta < 0) return 0;
    return clampPanelWidth((width > 0 ? width : fallback) + delta);
}
