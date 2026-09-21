import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { readdirSync } from 'node:fs';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

/** Every `aria-modal` dialog actually rendered by the app, comments and CSS-selector strings excluded. */
function modalRenderSites(): number {
    const root = new URL('./', import.meta.url);
    const walk = (dir: URL): number => readdirSync(dir, { withFileTypes: true }).reduce((count, entry) => {
        if (entry.isDirectory()) return count + walk(new URL(`${entry.name}/`, dir));
        if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return count;
        const source = readFileSync(new URL(entry.name, dir), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        // `[aria-modal="true"]` inside a querySelector is a lookup, not a dialog.
        return count + [...source.matchAll(/aria-modal="true"/g)]
            .filter((match) => source[match.index - 1] !== '[').length;
    }, 0);
    return walk(root);
}

/**
 * Two places in `App.tsx` name the same set of dialog state flags, and they
 * have to agree.
 *
 * `aDialogIsOpen` decides whether the keyboard shortcuts that move through the
 * game are held off; the `inert` effect uses the same flags as its
 * dependencies, because it has to re-run when *which* dialog is open changes,
 * not only when one opens. The flag list itself is already the fix for an
 * earlier bug -- the condition was written out twice and the second copy was
 * missing the command palette, so clicking the palette's own count line blurred
 * focus to `body` and the next arrow key stepped the game back to the start
 * behind the open palette. That list is still hand-written in two places, and
 * nothing but this notices when they drift.
 */
function flagsIn(expression: string): string[] {
    return [...expression.matchAll(/[A-Za-z_$][\w$]*/g)]
        .map((match) => match[0])
        .filter((name) => name !== 'Boolean' && name !== 'aDialogIsOpen');
}

describe('the dialog flag list', () => {
    const openMatch = /const aDialogIsOpen = Boolean\(([\s\S]*?)\);/.exec(appSource);
    const inertMatch = /\}, \[aDialogIsOpen,([\s\S]*?)\]\);/.exec(appSource);

    it('is named in both of the places that need it', () => {
        expect(openMatch, 'aDialogIsOpen has been renamed or reshaped').not.toBeNull();
        expect(inertMatch, 'the inert effect no longer depends on aDialogIsOpen').not.toBeNull();
    });

    it('holds the same flags in the condition and in the inert effect', () => {
        const condition = flagsIn(openMatch![1]);
        const dependencies = flagsIn(inertMatch![1]);
        // Sorted rather than ordered: the two lists are written for different
        // reasons and only their membership has to match.
        expect([...condition].sort()).toEqual([...dependencies].sort());
        // A guard against both lists being emptied into agreement.
        expect(condition.length).toBeGreaterThanOrEqual(8);
    });

    it('covers every modal dialog the app can show', () => {
        // A name comparison cannot see a dialog that was added with no flag at
        // all, so count the real render sites. Nine `aria-modal` dialogs are
        // gated by eight flags: DeferredDialogs' loading/failure notice only
        // renders inside the board editor or the rule lessons, which have one
        // flag each already.
        expect(modalRenderSites()).toBe(flagsIn(openMatch![1]).length + 1);
    });
});
