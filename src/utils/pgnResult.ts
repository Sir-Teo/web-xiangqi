import { extractPgnHeaders } from './gameMetadata';
import { parseResultTag, type RecordedResult } from './recordedResult';

/** Read only the first game's top-level result, excluding notes and variations. */
export function extractPgnResult(text: string): { result?: RecordedResult; error?: string; source?: string; hadMoreGames?: boolean } {
    const header = extractPgnHeaders(text).result;
    if (header !== undefined && header !== '*' && !parseResultTag(header)) return { error: 'Invalid Result header.' };
    // Exhaustive tokens keep parentheses adjacent to moves separate. Quoted
    // headers and comments are consumed whole, including result-looking text.
    const tokens = /\{[^}]*(?:\}|$)|;[^\n]*|^%[^\n]*|\[\s*[A-Za-z][A-Za-z0-9_]*\s+"(?:\\.|[^"\\])*"\s*\]|[()]|[^\s{}[\]();]+/gm;
    let depth = 0;
    let seenMoves = false;
    let marker: string | undefined;
    let gameEnd = text.length;
    for (const match of text.matchAll(tokens)) {
        const token = match[0];
        if (/^[{;%]/.test(token)) continue;
        if (marker !== undefined) { gameEnd = match.index; break; }
        if (token[0] === '[') { if (seenMoves && depth === 0) { gameEnd = match.index; break; } continue; }
        if (token === '(') { depth++; continue; }
        if (token === ')') { depth = Math.max(0, depth - 1); continue; }
        if (depth) continue;
        if (token === '*' || parseResultTag(token)) { marker = token; continue; }
        seenMoves = true;
    }
    if (header !== undefined && marker !== undefined && header !== marker) return { error: 'The Result header disagrees with the final result marker.' };
    return { result: parseResultTag(marker ?? header), source: text.slice(0, gameEnd), hadMoreGames: gameEnd < text.length };
}
