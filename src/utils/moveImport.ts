import type { SavedMoveTreeNode } from './gameLibrary';

export const MAX_MOVE_IMPORT_TEXT_LENGTH = 200_000;
export const MAX_MOVE_IMPORT_UCI_MOVES = 1024;
export const MAX_MOVE_IMPORT_TREE_NODES = 1024;

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

/**
 * Replaces each `open...close` run with a space, in one pass.
 *
 * The obvious regex — `/\{[^}]*}/g` — backtracks from every opening character
 * that has no closing one, which is quadratic. Pasting something that is not
 * really a game record but is full of brackets (a minified script, a JSON
 * dump) took seconds rather than being rejected. Semantics are unchanged: a
 * run ends at the first closing character, and an unterminated opener is left
 * in place exactly as the regex left it.
 */
function stripDelimited(text: string, open: string, close: string): string {
    if (!text.includes(open)) return text;

    let out = '';
    let index = 0;
    for (;;) {
        const start = text.indexOf(open, index);
        if (start < 0) return out + text.slice(index);
        const end = text.indexOf(close, start + 1);
        if (end < 0) return out + text.slice(index);
        out += `${text.slice(index, start)} `;
        index = end + 1;
    }
}

function stripPgnMetadata(text: string): string {
    const withoutTags = stripDelimited(String(text), '[', ']');
    return stripDelimited(withoutTags, '{', '}').replace(/;.*$/gm, ' ');
}

const UCI_MOVE_PATTERN = /\b([a-i][0-9])([a-i][0-9])\b|\b([a-i][0-9])\s*(?:->|=>|[-x:→–—])\s*([a-i][0-9])\b/gi;
const UCI_TREE_TOKEN_PATTERN = /\(|\)|\b([a-i][0-9])([a-i][0-9])\b|\b([a-i][0-9])\s*(?:->|=>|[-x:→–—])\s*([a-i][0-9])\b/gi;

function hasBranch(nodes: SavedMoveTreeNode[]): boolean {
    return nodes.some((node) => (node.children?.length ?? 0) > 1 || hasBranch(node.children ?? []));
}

function mainLineFromTree(line: SavedMoveTreeNode[]): string[] {
    return line.map((node) => node.uci);
}

function recoverFinalMainLine(currentLine: SavedMoveTreeNode[], stack: SavedMoveTreeNode[][]): SavedMoveTreeNode[] {
    if (stack.length === 0) return currentLine;
    return stack[0].length > 0 ? stack[0] : currentLine;
}

export function isMoveImportTextTooLarge(text: string): boolean {
    return String(text).length > MAX_MOVE_IMPORT_TEXT_LENGTH;
}

export function extractUciMoveLine(text: string): string[] {
    const cleaned = stripParentheticalVariations(stripPgnMetadata(text));
    const moves: string[] = [];
    for (const match of cleaned.matchAll(UCI_MOVE_PATTERN)) {
        // Checked before the push, the way extractUciMoveTree does it. Testing
        // after meant returning one move past the cap, and the library refuses
        // a line longer than the cap — so the longest importable game could not
        // then be saved.
        if (moves.length >= MAX_MOVE_IMPORT_UCI_MOVES) break;
        const from = match[1] ?? match[3];
        const to = match[2] ?? match[4];
        moves.push(`${from}${to}`.toLowerCase());
    }
    return moves;
}

export function extractUciMoveTree(text: string): {
    moves: string[];
    moveTree: SavedMoveTreeNode[];
    hasVariations: boolean;
    tooLarge: boolean;
} {
    const cleaned = stripPgnMetadata(text);
    const root: SavedMoveTreeNode[] = [];
    const stack: SavedMoveTreeNode[][] = [];
    let currentLine: SavedMoveTreeNode[] = [];
    let nodeCount = 0;
    let tooLarge = false;

    for (const match of cleaned.matchAll(UCI_TREE_TOKEN_PATTERN)) {
        const token = match[0];
        if (token === '(') {
            stack.push(currentLine);
            currentLine = currentLine.slice(0, -1);
            continue;
        }
        if (token === ')') {
            currentLine = stack.pop() ?? currentLine;
            continue;
        }

        const from = match[1] ?? match[3];
        const to = match[2] ?? match[4];
        if (!from || !to) continue;
        if (nodeCount >= MAX_MOVE_IMPORT_TREE_NODES) {
            tooLarge = true;
            break;
        }

        nodeCount += 1;
        const node: SavedMoveTreeNode = { uci: `${from}${to}`.toLowerCase() };
        const parent = currentLine[currentLine.length - 1];
        if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(node);
        } else {
            root.push(node);
        }
        currentLine = [...currentLine, node];
    }

    return {
        moves: mainLineFromTree(recoverFinalMainLine(currentLine, stack)),
        moveTree: root,
        hasVariations: root.length > 1 || hasBranch(root),
        tooLarge,
    };
}

export function extractFenTag(text: string): string | null {
    const match = String(text).match(/\[\s*FEN\s+"((?:\\.|[^"\\])*)"\s*]/i);
    if (!match) return null;
    return match[1]
        .replace(/\\(["\\])/g, '$1')
        .trim()
        .replace(/\s+/g, ' ') || null;
}
