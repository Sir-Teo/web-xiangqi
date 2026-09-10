/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A class name that looks like a utility framework's, and that no stylesheet
 * defines, does nothing at all.
 *
 * `className="engine-output-terminal mt-4"` sat in the engine panel asking for
 * a Tailwind margin. There is no Tailwind here and no `.mt-4` anywhere, so the
 * declaration it was reaching for never existed: the terminal has always had
 * whatever gap its parent gives it. Nothing warns about this -- not the build,
 * not the linter, not the browser -- because an unmatched class is legal and
 * inert, exactly like the undefined `var(--border)` next door in
 * `__cssTokens.test.ts`.
 *
 * Both halves are needed, and neither is enough alone:
 *
 * - **Shape alone** would flag a hand-written `.gap-2` the moment someone
 *   wrote one, so a class the stylesheets define is fine whatever it is named.
 * - **"No CSS rule" alone** is far too loud. 43 of the 523 class names this
 *   app applies have no rule of their own, and nearly all are legitimate:
 *   markers that pair with a styled sibling (`captured-piece-black` beside
 *   `captured-piece-red`, where the base class already *is* the black look),
 *   hooks the browser gates query (`board-arrows-layer`), and names that
 *   simply read well next to a `data-testid`. Flagging those would mean either
 *   deleting useful markup or maintaining an allowlist that grows faster than
 *   the check earns its keep.
 *
 * Together they are precise: a name in a vocabulary this project does not use,
 * pointing at a rule that does not exist.
 *
 * Only quoted `className="..."` literals are read. Utility classes arrive that
 * way -- pasted from another codebase's markup -- and skipping template
 * expressions avoids parsing the ternaries inside them, which is where a
 * naive scan starts reporting `?` and `===` as class names.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

function filesUnder(dir: string, extension: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return filesUnder(path, extension);
        return path.endsWith(extension) ? [path] : [];
    });
}

/**
 * Spacing, sizing, typography and flexbox utilities as Tailwind, Bootstrap and
 * their imitators spell them. Deliberately a closed list of shapes rather than
 * "anything with a digit": `cloud-book-rank-2` is this app's own and must not
 * match.
 */
const UTILITY_SHAPES = [
    /^[mp][trblxyse]?-\d+$/,
    /^(gap|space)-[xy]?-?\d+$/,
    /^[wh]-(full|screen|auto|\d+)$/,
    /^text-(xs|sm|base|lg|xl|\d?xl|left|center|right)$/,
    /^font-(thin|light|normal|medium|semibold|bold|black)$/,
    /^flex-(1|auto|none|row|col|wrap)$/,
    /^(items|justify|self)-(start|end|center|between|around|evenly|stretch|baseline)$/,
    /^(rounded|shadow|border)-(none|sm|md|lg|xl|full|\d+)$/,
];

function looksLikeAUtility(className: string): boolean {
    return UTILITY_SHAPES.some((shape) => shape.test(className));
}

/** Every class in a quoted `className="a b c"`, with its file. */
function quotedClassNames(source: string): string[] {
    return Array.from(source.matchAll(/className="([^"{}$]*)"/g))
        .flatMap((match) => match[1].split(/\s+/))
        .filter((name) => /^[a-zA-Z][\w-]*$/.test(name));
}

/** `.name` anywhere in a selector, comments stripped so a mention is not a rule. */
function definedClassNames(css: string): Set<string> {
    return new Set(
        Array.from(css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g), (match) => match[1])
    );
}

const cssPaths = filesUnder(HERE, '.css');
const tsxPaths = filesUnder(HERE, '.tsx').filter((path) => !path.endsWith('.test.tsx'));
const defined = definedClassNames(cssPaths.map((path) => readFileSync(path, 'utf8')).join('\n'));
const applied = new Map<string, string[]>();
for (const path of tsxPaths) {
    for (const name of quotedClassNames(readFileSync(path, 'utf8'))) {
        applied.set(name, [...(applied.get(name) ?? []), path]);
    }
}

describe('class names', () => {
    it('has markup and stylesheets to check, so an empty pass cannot look like a clean one', () => {
        expect(cssPaths.length).toBeGreaterThan(3);
        expect(tsxPaths.length).toBeGreaterThan(5);
        expect(applied.size).toBeGreaterThan(200);
    });

    it('applies no utility class that nothing defines', () => {
        const dead = [...applied]
            .filter(([name]) => looksLikeAUtility(name) && !defined.has(name))
            .map(([name, paths]) => `${name} (${paths.join(', ')})`)
            .sort();
        expect(dead, `inert utility classes: ${dead.join('; ')}`).toEqual([]);
    });

    it('would notice one, and leaves this app own names alone', () => {
        // The guard on the guard: the shapes have to separate the two cases.
        expect(['mt-4', 'p-2', 'w-full', 'text-sm', 'justify-between'].filter(looksLikeAUtility))
            .toHaveLength(5);
        expect(
            ['cloud-book-rank-2', 'captured-piece-black', 'mobile-action-btn', 'quality-mistake', 'lib-result--red']
                .filter(looksLikeAUtility)
        ).toEqual([]);
    });

    it('reads a quoted className and skips a template expression', () => {
        expect(quotedClassNames('<div className="a-b c-d" />')).toEqual(['a-b', 'c-d']);
        expect(quotedClassNames('<div className={`x ${on ? "y" : "z"}`} />')).toEqual([]);
    });

    it('does not count a class named only inside a comment as defined', () => {
        expect(definedClassNames('/* .ghost was removed */ .real { color: red; }').has('ghost')).toBe(false);
        expect(definedClassNames('/* .ghost was removed */ .real { color: red; }').has('real')).toBe(true);
    });
});
