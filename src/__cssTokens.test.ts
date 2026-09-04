/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every `var(--token)` written without a fallback resolves to something.
 *
 * A custom property that does not exist does not fall back to a sensible
 * default -- it takes the whole declaration with it. `border: 1px solid
 * var(--border)` where `--border` is undefined is *invalid at computed-value
 * time*, so the declaration becomes `unset` and no border is drawn at all.
 * Nothing warns: not the build, not the linter, not the browser's console.
 *
 * This is not hypothetical. The tokens here are `--border-subtle`,
 * `--border-default`, `--border-strong` and `--border-accent`; four rules
 * written in one sitting all reached for a `--border` that has never existed,
 * and all four silently drew nothing. It was found by reading a computed style
 * rather than the stylesheet, which is not something anyone does by habit.
 *
 * A `var(--token, fallback)` is deliberately allowed. Those are how values set
 * from JavaScript are read -- the panel widths, the drag offsets -- and the
 * fallback is the point.
 *
 * ## Two things this file had to get wrong first
 *
 * `import.meta.glob('./**\/*.css', { query: '?raw' })` is the Vite-native way
 * to read these and it does not work: Vite's CSS plugin answers first, and
 * every stylesheet arrives as an empty string. The glob finds all nine files
 * and the check then passes over nothing, which is why the first assertion
 * here is that there is something to check at all.
 *
 * And `node:fs` in `src/` does not typecheck on its own. `tsconfig.app.json`
 * types this directory for the browser -- `"types": ["vite/client"]` -- so the
 * node module declarations are excluded until the reference above asks for
 * them. Vitest transpiles without checking, so this failed only under
 * `npm run typecheck`, which is the split the README warns about.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

function cssFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return cssFiles(path);
        return path.endsWith('.css') ? [path] : [];
    });
}

const paths = cssFiles(HERE);
const allCss = paths.map((path) => readFileSync(path, 'utf8')).join('\n');

/** `--name:` at the start of a declaration, which is where one is defined. */
function definedTokens(css: string): Set<string> {
    return new Set(Array.from(css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g), (match) => match[1]));
}

/** `var(--name)` with nothing after the name: no fallback to save it. */
function tokensUsedWithoutFallback(css: string): Set<string> {
    return new Set(Array.from(css.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/g), (match) => match[1]));
}

describe('CSS custom properties', () => {
    it('has stylesheets to check, so an empty pass cannot look like a clean one', () => {
        expect(paths.length).toBeGreaterThan(3);
        expect(allCss.length).toBeGreaterThan(50_000);
    });

    it('defines every token used without a fallback', () => {
        const defined = definedTokens(allCss);
        const missing = [...tokensUsedWithoutFallback(allCss)].filter((token) => !defined.has(token)).sort();
        expect(missing, `undefined: ${missing.join(', ')}`).toEqual([]);
    });

    it('would notice a token that had gone missing', () => {
        // The guard on the guard: the same two functions, run over a stylesheet
        // that really is broken, have to disagree.
        const broken = ':root { --a: red; }\n.x { color: var(--a); border-color: var(--gone); }';
        const defined = definedTokens(broken);
        const missing = [...tokensUsedWithoutFallback(broken)].filter((token) => !defined.has(token));
        expect(missing).toEqual(['--gone']);
    });

    it('leaves a token with a fallback alone, since that is how JS-set values are read', () => {
        const withFallback = '.x { width: var(--left-panel-w, 280px); }';
        expect([...tokensUsedWithoutFallback(withFallback)]).toEqual([]);
    });
});
