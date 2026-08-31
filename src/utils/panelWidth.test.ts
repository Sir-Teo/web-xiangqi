import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PANEL_WIDTH,
    PANEL_KEYBOARD_STEP,
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    clampPanelWidth,
    initialPanelWidth,
    stepPanelWidth,
} from './panelWidth';

describe('the width a panel opens at', () => {
    it('uses the default when the window is wide enough for it', () => {
        expect(initialPanelWidth(DEFAULT_PANEL_WIDTH, 1440)).toBe(DEFAULT_PANEL_WIDTH);
        expect(initialPanelWidth(DEFAULT_PANEL_WIDTH, 1920)).toBe(DEFAULT_PANEL_WIDTH);
    });

    it('leaves the board more than either panel on a narrow window', () => {
        // The defect: at 920px two 320px panels took 640 and left the board 248,
        // smaller than either of them.
        const width = 920;
        const panel = initialPanelWidth(DEFAULT_PANEL_WIDTH, width);
        expect(width - panel * 2).toBeGreaterThan(panel);
    });

    it('never opens narrower than the minimum, however small the window', () => {
        for (const width of [320, 375, 500, 0]) {
            expect(initialPanelWidth(DEFAULT_PANEL_WIDTH, width)).toBeGreaterThanOrEqual(PANEL_MIN_WIDTH);
        }
    });

    it('never opens wider than it was asked for', () => {
        for (const width of [320, 920, 1440, 3840]) {
            expect(initialPanelWidth(DEFAULT_PANEL_WIDTH, width)).toBeLessThanOrEqual(DEFAULT_PANEL_WIDTH);
        }
    });
});

describe('holding a width inside what a panel may be', () => {
    it('closes rather than snapping back open below the minimum', () => {
        // A panel narrower than the minimum is one the user is closing.
        // Returning the minimum would make it impossible to close by dragging.
        expect(clampPanelWidth(PANEL_MIN_WIDTH - 1)).toBe(0);
        expect(clampPanelWidth(10)).toBe(0);
        expect(clampPanelWidth(0)).toBe(0);
        expect(clampPanelWidth(-50)).toBe(0);
    });

    it('keeps the minimum itself open', () => {
        expect(clampPanelWidth(PANEL_MIN_WIDTH)).toBe(PANEL_MIN_WIDTH);
    });

    it('stops at the maximum', () => {
        expect(clampPanelWidth(PANEL_MAX_WIDTH + 200)).toBe(PANEL_MAX_WIDTH);
        expect(clampPanelWidth(99999)).toBe(PANEL_MAX_WIDTH);
    });

    it('rounds a dragged fraction', () => {
        expect(clampPanelWidth(320.6)).toBe(321);
    });
});

describe('one keyboard step', () => {
    it('reopens a closed panel at the default rather than doing nothing', () => {
        // Stepping 0 -> 40 lands under the minimum and clamps back to 0, so
        // without the fallback the widen key does nothing on a closed panel.
        expect(stepPanelWidth(0, PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH))
            .toBe(DEFAULT_PANEL_WIDTH + PANEL_KEYBOARD_STEP);
    });

    it('lets a keyboard user come to rest on collapsed', () => {
        // Shrinking used to borrow the same fallback, so the narrow key reopened
        // a closed panel to 280 and collapsed was unreachable from the keyboard.
        expect(stepPanelWidth(0, -PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH)).toBe(0);
    });

    it('closes a panel stepped below the minimum', () => {
        expect(stepPanelWidth(PANEL_MIN_WIDTH + 10, -PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH)).toBe(0);
    });

    it('steps an open panel by the step', () => {
        expect(stepPanelWidth(320, PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH)).toBe(360);
        expect(stepPanelWidth(320, -PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH)).toBe(280);
    });

    it('cannot be pushed past the maximum by stepping', () => {
        expect(stepPanelWidth(PANEL_MAX_WIDTH, PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH)).toBe(PANEL_MAX_WIDTH);
    });

    it('reaches collapsed and reopens, so the keyboard can round-trip', () => {
        let width = 320;
        for (let i = 0; i < 20; i += 1) width = stepPanelWidth(width, -PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH);
        expect(width).toBe(0);
        expect(stepPanelWidth(width, PANEL_KEYBOARD_STEP, DEFAULT_PANEL_WIDTH)).toBeGreaterThan(0);
    });
});
