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

export function extractUciMoveLine(text: string): string[] {
    return stripParentheticalVariations(String(text)
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\{[^}]*}/g, ' ')
        .replace(/;.*$/gm, ' '))
        .match(/\b[a-i][0-9][a-i][0-9][a-z]?\b/gi)
        ?.map((move) => move.slice(0, 4).toLowerCase()) ?? [];
}

export function extractFenTag(text: string): string | null {
    const match = String(text).match(/\[\s*FEN\s+"((?:\\.|[^"\\])*)"\s*]/i);
    if (!match) return null;
    return match[1]
        .replace(/\\(["\\])/g, '$1')
        .trim()
        .replace(/\s+/g, ' ') || null;
}
