type PgnToken = {
    text: string;
    start: number;
} & ({ kind: 'tag'; name: string; value: string } | { kind: 'comment' | 'escape' | 'text' });

/** Keep quoted headers and non-nesting comments whole, including fake tokens. */
export function* pgnTokens(source: string): Generator<PgnToken> {
    const pattern = /\{[^}]*(?:\}|$)|;[^\n]*|^%[^\n]*|\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\s*\]|[()]|[^\s{}[\]();]+|[{}[\]]/gm;
    for (const match of source.matchAll(pattern)) {
        const text = match[0];
        if (match[1] !== undefined) {
            yield { kind: 'tag', text, start: match.index, name: match[1], value: match[2] };
        } else {
            const kind = text[0] === '{' || text[0] === ';' ? 'comment'
                : text[0] === '%' && (match.index === 0 || source[match.index - 1] === '\n') ? 'escape' : 'text';
            yield { kind, text, start: match.index };
        }
    }
}

/** A leading/interleaved header comment is not the start of the movetext. */
export function firstPgnGame(source: string): { text: string; truncated: boolean; marker?: string } {
    let depth = 0;
    let seenMoves = false;
    let marker: string | undefined;
    let end = source.length;
    for (const token of pgnTokens(source)) {
        if (token.kind === 'comment' || token.kind === 'escape') continue;
        if (marker !== undefined) { end = token.start; break; }
        if (token.kind === 'tag') {
            if (seenMoves && depth === 0) { end = token.start; break; }
            continue;
        }
        if (token.text === '(') { depth++; continue; }
        if (token.text === ')') { depth = Math.max(0, depth - 1); continue; }
        if (depth) continue;
        if (/^(?:1-0|0-1|1\/2-1\/2|\*)$/.test(token.text)) { marker = token.text; continue; }
        seenMoves = true;
    }
    return { text: source.slice(0, end), truncated: end < source.length, ...(marker ? { marker } : {}) };
}
