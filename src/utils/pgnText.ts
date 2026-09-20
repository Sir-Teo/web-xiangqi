type PgnToken = {
    text: string;
    start: number;
} & ({ kind: 'tag'; name: string; value: string } | { kind: 'comment' | 'escape' | 'text' });

/**
 * A tag pair taken whole, quoted value and all.
 *
 * The value is read as a quoted string rather than "everything up to the first
 * `]`", because a `]` is legal inside one -- an event called `Demo ] a3a4` ends
 * the tag early under the simpler rule and hands the movetext reader a
 * coordinate nobody played.
 */
const TAG_PAIR_SOURCE = '\\[\\s*([A-Za-z][A-Za-z0-9_]*)\\s+"((?:\\\\.|[^"\\\\])*)"\\s*\\]';
const TAG_PAIR = new RegExp(TAG_PAIR_SOURCE, 'y');

/**
 * A line ends at CR as well as LF.
 *
 * `;` remarks and `%` escape lines run to the end of their line, and a record
 * saved by an old Mac editor -- or pasted out of one -- separates lines with CR
 * alone. Terminating only at LF swallows the rest of such a file into the
 * remark, and the moves in it disappear.
 */
const LINE_END = /[\n\r]/g;

/**
 * Where the line holding `from` ends: the index of its terminator, or the end
 * of the text. Shared so every reader of this format agrees what a line is --
 * they did not, and a `;` remark in a CR-separated record ran to end of file
 * in two of them, taking the moves after it.
 */
export function pgnLineEnd(source: string, from: number): number {
    LINE_END.lastIndex = from;
    const terminator = LINE_END.exec(source);
    return terminator ? terminator.index : source.length;
}

/** Whether `index` begins a line, which is what makes a `%` an escape line. */
export function atPgnLineStart(source: string, index: number): boolean {
    return index === 0 || source[index - 1] === '\n' || source[index - 1] === '\r';
}

/** Keep quoted headers and non-nesting comments whole, including fake tokens. */
export function* pgnTokens(source: string): Generator<PgnToken> {
    const pattern = new RegExp(`\\{[^}]*(?:\\}|$)|;[^\\n\\r]*|^%[^\\n\\r]*|${TAG_PAIR_SOURCE}|[()]|[^\\s{}[\\]();]+|[{}[\\]]`, 'gm');
    for (const match of source.matchAll(pattern)) {
        const text = match[0];
        if (match[1] !== undefined) {
            yield { kind: 'tag', text, start: match.index, name: match[1], value: match[2] };
        } else {
            const kind = text[0] === '{' || text[0] === ';' ? 'comment'
                : text[0] === '%' && atPgnLineStart(source, match.index) ? 'escape' : 'text';
            yield { kind, text, start: match.index };
        }
    }
}

/** A stretch of a record that is not movetext, and whatever note it carried. */
export interface PgnMetadataSpan {
    start: number;
    /** Exclusive. */
    end: number;
    /**
     * The body of a `{...}` comment or a `;` remark. Absent for tags and for
     * `%` escape lines, which carry nothing a reader is meant to keep: the
     * format reserves them for other software, so their contents are dropped
     * rather than offered as prose.
     */
    comment?: string;
}

/**
 * Walks the parts of a record that are not movetext: tags, `{...}` comments,
 * `;` remarks and `%` escape lines.
 *
 * Positions rather than cleaned text, because the callers want different
 * things from the same walk -- one blanks the spans, one reads the comments
 * while blanking them, one annotates the move each comment follows -- and
 * because a coordinate reader must still see the raw gap between two spans, so
 * a move written `a3 -> a4` stays one string.
 *
 * Recovery from an unterminated opener is deliberate and matches what the
 * coordinate readers have always done: the opener is left where it is and what
 * follows is still read as moves. A record truncated mid-comment should not
 * lose the moves before the truncation as well.
 */
export function* pgnMetadataSpans(source: string): Generator<PgnMetadataSpan> {
    const openers = /[[{;%]/g;
    // One failed search settles it for the rest of the text: if there is no
    // closer after this opener there is none after any later one either. A
    // paste that is not really a record -- a minified script, a JSON dump --
    // can hold tens of thousands of openers, and rescanning the suffix at each
    // one is quadratic.
    let noBrace = false;
    let noBracket = false;
    for (let opener = openers.exec(source); opener; opener = openers.exec(source)) {
        const start = opener.index;
        let end: number;
        let comment: string | undefined;
        if (opener[0] === '%') {
            // Only at the start of a line. Elsewhere it is ordinary text.
            if (!atPgnLineStart(source, start)) continue;
            end = pgnLineEnd(source, start);
        } else if (opener[0] === ';') {
            end = pgnLineEnd(source, start);
            comment = source.slice(start + 1, end);
        } else if (opener[0] === '{') {
            const close = noBrace ? -1 : source.indexOf('}', start + 1);
            if (close < 0) { noBrace = true; continue; }
            end = close + 1;
            comment = source.slice(start + 1, close);
        } else {
            TAG_PAIR.lastIndex = start;
            const pair = TAG_PAIR.exec(source);
            if (pair) {
                end = start + pair[0].length;
            } else {
                // Not a well-formed pair, so fall back to the blunt rule: a
                // malformed header still must not be read as moves.
                const close = noBracket ? -1 : source.indexOf(']', start + 1);
                if (close < 0) { noBracket = true; continue; }
                end = close + 1;
            }
        }
        yield comment === undefined ? { start, end } : { start, end, comment };
        openers.lastIndex = end;
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
