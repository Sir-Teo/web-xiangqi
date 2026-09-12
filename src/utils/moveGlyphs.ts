/** Supplied PGN annotations, independent of the engine's current move grade. */
export type MoveGlyphs = { nags?: number[] };

const suffixes: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const symbols: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 10: '=', 13: '∞', 14: '+=', 15: '=+', 16: '±', 17: '∓', 18: '+−', 19: '−+' };
const descriptions: Record<number, string> = {
    0: 'Null annotation', 1: 'Good move', 2: 'Poor move', 3: 'Very good move', 4: 'Very poor move',
    5: 'Speculative move', 6: 'Questionable move', 7: 'Forced move', 8: 'Only reasonable move', 9: 'Worst move',
    10: 'Drawish position', 11: 'Equal chances, quiet position', 12: 'Equal chances, active position', 13: 'Unclear position',
    14: 'Red has a slight advantage', 15: 'Black has a slight advantage', 16: 'Red has a moderate advantage',
    17: 'Black has a moderate advantage', 18: 'Red has a decisive advantage', 19: 'Black has a decisive advantage',
};

/** PGN defines the complete code space as integers 0–255; keep unknown codes. */
export function normalizeMoveGlyphs(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const unique = new Set<number>();
    for (const code of value) {
        if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255) unique.add(code);
        if (unique.size === 256) break;
    }
    return unique.size ? [...unique] : undefined;
}

export function parsePgnGlyph(token: string): number | undefined {
    if (Object.hasOwn(suffixes, token)) return suffixes[token];
    if (!/^\$\d+$/.test(token)) return undefined;
    const code = Number(token.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 255 ? code : undefined;
}

/** The parser owns this mutable target until it hands the tree to the app. */
export function appendPgnGlyph(target: MoveGlyphs, token: string): boolean {
    const code = parsePgnGlyph(token);
    if (code === undefined) return false;
    if (!target.nags) target.nags = [code];
    else if (!target.nags.includes(code)) target.nags.push(code);
    return true;
}

export function glyphSymbol(code: number): string { return symbols[code] ?? `$${code}`; }
export function describeGlyph(code: number): string { return descriptions[code] ?? `PGN annotation $${code}`; }
export function describeMoveGlyphs(nags: number[] | undefined): string {
    return nags?.length ? `Imported annotations: ${nags.map(code => `${glyphSymbol(code)} (${describeGlyph(code)})`).join(', ')}` : '';
}
