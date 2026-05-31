export function extractUciMoveLine(text: string): string[] {
    return String(text)
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\{[^}]*}/g, ' ')
        .replace(/;.*$/gm, ' ')
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
