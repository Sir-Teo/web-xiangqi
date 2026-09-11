/**
 * Replaces each `open...close` run in one pass; leaves unclosed runs intact.
 *
 * The obvious regex — `/\{[^}]*}/g` — backtracks from every opening character
 * that has no closing one, which is quadratic. Pasting something that is not
 * really a game record but is full of brackets (a minified script, a JSON
 * dump) took seconds rather than being rejected. Semantics are unchanged: a
 * run ends at the first closing character, and an unterminated opener is left
 * in place exactly as the regex left it.
 */
export function stripDelimited(text: string, open: string, close: string, replacement = ' '): string {
    if (!text.includes(open)) return text;

    let out = '';
    let index = 0;
    for (;;) {
        const start = text.indexOf(open, index);
        if (start < 0) return out + text.slice(index);
        const end = text.indexOf(close, start + open.length);
        if (end < 0) return out + text.slice(index);
        out += text.slice(index, start) + replacement;
        index = end + close.length;
    }
}

