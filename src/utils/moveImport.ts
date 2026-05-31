function stripParentheticalVariations(text: string): string {
    let depth = 0;
    let result = '';

    for (const char of text) {
        if (char === '(') {
            depth += 1;
            result += ' ';
            continue;
        }
        if (char === ')' && depth > 0) {
            depth -= 1;
            result += ' ';
            continue;
        }
        if (depth === 0) {
            result += char;
        }
    }

    return result;
}

function stripPgnMetadata(text: string): string {
    return String(text)
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\{[^}]*}/g, ' ')
        .replace(/;.*$/gm, ' ');
}

const UCI_MOVE_PATTERN = /\b([a-i][0-9])([a-i][0-9])([a-z])?\b|\b([a-i][0-9])\s*(?:->|=>|[-x:→–—])\s*([a-i][0-9])\b/gi;

export function extractUciMoveLine(text: string): string[] {
    const cleaned = stripParentheticalVariations(stripPgnMetadata(text));
    return Array.from(cleaned.matchAll(UCI_MOVE_PATTERN), (match) => {
        const from = match[1] ?? match[4];
        const to = match[2] ?? match[5];
        return `${from}${to}`.toLowerCase();
    });
}

export function extractFenTag(text: string): string | null {
    const match = String(text).match(/\[\s*FEN\s+"((?:\\.|[^"\\])*)"\s*]/i);
    if (!match) return null;
    return match[1]
        .replace(/\\(["\\])/g, '$1')
        .trim()
        .replace(/\s+/g, ' ') || null;
}
