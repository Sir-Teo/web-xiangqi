import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const gate = readFileSync(new URL('./test-ui-layout.cjs', import.meta.url), 'utf8');

/** Doc blocks with nothing but another doc block after them. */
function strandedDocs(source: string): string[] {
    const stranded: string[] = [];
    const blocks = [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)];
    for (const block of blocks) {
        const end = block.index + block[0].length;
        const next = end + (source.slice(end).match(/^\s*/)?.[0].length ?? 0);
        if (!source.startsWith('/**', next)) continue;
        stranded.push(block[0].split('\n')[1]?.replace(/^\s*\*\s?/, '').trim().slice(0, 60) ?? '');
    }
    return stranded;
}

/**
 * A doc block in the gate file explains the assertion under it. When two stack
 * up, the first one explains nothing.
 *
 * This happens by accident, and it happened to me: inserting a new assertion
 * at the `async function` line of an existing one lands the new block *between*
 * that assertion and its own rationale, and nothing complains. The result is
 * that a carefully argued paragraph -- why the check exists, what broke to make
 * it necessary -- now sits above an unrelated function, and the assertion it
 * belongs to has none. In a file whose comments are most of its value, that is
 * the expensive kind of rot.
 *
 * All twenty-two that were adrift have been reunited, so this is now a plain
 * rule rather than a ratchet: no doc block in this file may be followed by
 * another one.
 *
 * Matching them by keyword did not work -- the best automatic guess for the
 * doc about the opening explorer was an assertion about notation styles. Two
 * things did. A doc displaced by a single insertion belongs to the function
 * *after* the one it now sits above, which settled five where the doc's
 * opening line and the function's name said the same thing. For the rest,
 * listing the assertions that carry no doc at all turns it into a matching
 * exercise between two short lists, and most pair almost verbatim: "A link
 * that does not load has to say why." against
 * `assertShareLinkSaysWhyItDidNotLoad`.
 *
 * Every one was then checked to sit immediately above its function with no
 * gap, and no function was given two.
 */
describe('every doc block in the layout gate has an assertion under it', () => {
    const KNOWN_STRANDED = 0;

    it(`has no more than the ${KNOWN_STRANDED} that were already adrift`, () => {
        const stranded = strandedDocs(gate);
        expect(
            stranded.length,
            stranded.length > KNOWN_STRANDED
                ? 'A new doc block has nothing under it. Inserting an assertion at the `async function` line ' +
                  'of another one splits that one from its rationale: insert above its doc block instead. ' +
                  `Adrift now:\n  ${stranded.slice(-6).join('\n  ')}`
                : `Fewer are adrift than before -- lower KNOWN_STRANDED to ${stranded.length}.`
        ).toBe(KNOWN_STRANDED);
    });

    it('can tell an attached doc from a stranded one', () => {
        // Without this the count above could be measuring nothing.
        expect(strandedDocs('/** a */\nfunction one() {}\n/** b */\nfunction two() {}\n')).toEqual([]);
        expect(strandedDocs('/**\n * a\n */\n/**\n * b\n */\nfunction two() {}\n')).toEqual(['a']);
    });
});
