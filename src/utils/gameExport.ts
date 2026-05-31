import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';
import type { GameResult } from '../hooks/useXiangqi';
import type { GameMode } from '../App';
import type { SavedMoveTreeNode } from './gameLibrary';
import { START_FEN } from './xiangqi';

const RESULT_TAG: Record<NonNullable<GameResult>, string> = {
    'red-wins':   '1-0',
    'black-wins': '0-1',
    'draw':       '1/2-1/2',
};

const DEFAULT_START_POSITION_FEN = `${START_FEN} w - - 0 1`;

type PgnSide = 'w' | 'b';

interface PgnStartPosition {
    fen: string;
    sideToMove: PgnSide;
    fullmove: number;
    isCustom: boolean;
}

function normalizeFen(fen?: string): string {
    return String(fen || '').trim().replace(/\s+/g, ' ');
}

function parsePgnStartPosition(startFen?: string): PgnStartPosition {
    const fen = normalizeFen(startFen) || DEFAULT_START_POSITION_FEN;
    const parts = fen.split(/\s+/);
    const sideToMove: PgnSide = parts[1] === 'b' ? 'b' : 'w';
    const parsedFullmove = Number(parts[5]);
    const fullmove = Number.isFinite(parsedFullmove) && parsedFullmove > 0
        ? Math.trunc(parsedFullmove)
        : 1;

    return {
        fen,
        sideToMove,
        fullmove,
        isCustom: fen !== DEFAULT_START_POSITION_FEN,
    };
}

function escapeTagValue(value: string): string {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, ' ');
}

function tagLine(name: string, value: string): string {
    return `[${name} "${escapeTagValue(value)}"]`;
}

function buildMoveText(uciMoves: string[], startPosition: PgnStartPosition, result: string): string {
    const movePairs: string[] = [];
    let sideToMove = startPosition.sideToMove;
    let moveNumber = startPosition.fullmove;

    for (const uci of uciMoves) {
        if (sideToMove === 'w') {
            movePairs.push(`${moveNumber}. ${uci}`);
        } else {
            const whiteHalfMovePrefix = `${moveNumber}. `;
            if (movePairs.length > 0 && movePairs[movePairs.length - 1].startsWith(whiteHalfMovePrefix)) {
                movePairs[movePairs.length - 1] += ` ${uci}`;
            } else {
                movePairs.push(`${moveNumber}... ${uci}`);
            }
            moveNumber += 1;
        }

        sideToMove = sideToMove === 'w' ? 'b' : 'w';
    }

    const moveText = movePairs.join(' ');
    return `${moveText}${moveText ? ' ' : ''}${result}`;
}

function sideToMoveAtPly(startPosition: PgnStartPosition, plyIndex: number): PgnSide {
    const startsWithRed = startPosition.sideToMove === 'w';
    const redToMove = startsWithRed ? plyIndex % 2 === 0 : plyIndex % 2 !== 0;
    return redToMove ? 'w' : 'b';
}

function moveNumberAtPly(startPosition: PgnStartPosition, plyIndex: number): number {
    const blackRootOffset = startPosition.sideToMove === 'b' ? 1 : 0;
    return startPosition.fullmove + Math.floor((plyIndex + blackRootOffset) / 2);
}

function formatPgnMove(uci: string, startPosition: PgnStartPosition, plyIndex: number, forceMoveNumber: boolean) {
    const side = sideToMoveAtPly(startPosition, plyIndex);
    const moveNumber = moveNumberAtPly(startPosition, plyIndex);
    if (side === 'w') return `${moveNumber}. ${uci}`;
    return forceMoveNumber ? `${moveNumber}... ${uci}` : uci;
}

function buildPreferredChildMap(mainLineNodeIds: string[], treeNodes: Record<string, MoveTreeNode>) {
    const preferred = new Map<string, string>();
    for (const nodeId of mainLineNodeIds) {
        const parentId = treeNodes[nodeId]?.parentId;
        if (parentId) preferred.set(parentId, nodeId);
    }
    return preferred;
}

function buildTreeMoveText(
    treeNodes: Record<string, MoveTreeNode>,
    rootNodeId: string,
    startPosition: PgnStartPosition,
    mainLineNodeIds: string[],
    result: string
): string {
    const preferredChildByParent = buildPreferredChildMap(mainLineNodeIds, treeNodes);
    const renderFromParent = (parentId: string, plyIndex: number, forceMoveNumber: boolean, seen: Set<string>): string => {
        const parent = treeNodes[parentId];
        if (!parent?.childrenIds.length) return '';

        const preferredChild = preferredChildByParent.get(parentId);
        const mainChildId = preferredChild && parent.childrenIds.includes(preferredChild)
            ? preferredChild
            : parent.childrenIds[0];
        const variations = parent.childrenIds
            .filter((childId) => childId !== mainChildId)
            .map((childId) => renderLineFromNode(childId, parentId, plyIndex, true, seen))
            .filter(Boolean)
            .map((line) => `(${line})`);
        const mainText = renderMoveWithVariations(mainChildId, parentId, plyIndex, forceMoveNumber, variations, seen);

        return mainText;
    };

    const renderMoveWithVariations = (
        nodeId: string,
        parentId: string,
        plyIndex: number,
        forceMoveNumber: boolean,
        parentVariations: string[],
        seen: Set<string>
    ): string => {
        if (seen.has(nodeId)) return '';
        const node = treeNodes[nodeId];
        const record = node?.record;
        if (!node || !record || node.parentId !== parentId) return '';

        const nextSeen = new Set(seen);
        nextSeen.add(nodeId);
        const moveToken = formatPgnMove(record.uci, startPosition, plyIndex, forceMoveNumber);
        const continuation = renderFromParent(nodeId, plyIndex + 1, false, nextSeen);
        return [moveToken, ...parentVariations, continuation].filter(Boolean).join(' ');
    };

    const renderLineFromNode = (nodeId: string, parentId: string, plyIndex: number, forceMoveNumber: boolean, seen: Set<string>): string => {
        return renderMoveWithVariations(nodeId, parentId, plyIndex, forceMoveNumber, [], seen);
    };

    const moveText = renderFromParent(rootNodeId, 0, true, new Set());
    return `${moveText}${moveText ? ' ' : ''}${result}`;
}

function hasTreeMoves(treeNodes: Record<string, MoveTreeNode>, rootNodeId: string) {
    return Boolean(treeNodes[rootNodeId]?.childrenIds.some((childId) => treeNodes[childId]?.record));
}

function savedMoveTreeToNodes(moveTree: SavedMoveTreeNode[]) {
    const rootNodeId = 'root';
    const treeNodes: Record<string, MoveTreeNode> = {
        [rootNodeId]: { id: rootNodeId, parentId: null, childrenIds: [] },
    };
    let counter = 1;

    const appendChildren = (children: SavedMoveTreeNode[], parentId: string) => {
        for (const child of children) {
            const nodeId = `s${counter++}`;
            treeNodes[parentId].childrenIds.push(nodeId);
            treeNodes[nodeId] = {
                id: nodeId,
                parentId,
                childrenIds: [],
                record: { uci: child.uci } as MoveRecord,
            };
            appendChildren(child.children ?? [], nodeId);
        }
    };

    appendChildren(moveTree, rootNodeId);
    return { rootNodeId, treeNodes };
}

/**
 * Exports a game as a minimal PGN string using UCI (ICCS-compatible) move notation.
 * Compatible with analysis boards that accept Variant "Xiangqi".
 */
export function exportPgn(
    moves: MoveRecord[],
    options: {
        gameMode?: GameMode;
        opening?: string;
        label?: string;
        result?: GameResult;
        date?: string;
        startFen?: string;
    } = {}
): string {
    const result = options.result ? RESULT_TAG[options.result] : '*';
    const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const startPosition = parsePgnStartPosition(options.startFen);

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        options.gameMode ? tagLine('Event', options.gameMode) : null,
        options.label ? tagLine('White', options.label) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${buildMoveText(moves.map((move) => move.uci), startPosition, result)}\n`;
}

/**
 * Exports the full move tree as PGN with sibling branches preserved as variations.
 * The provided main line is used as the primary line; other legal children become
 * parenthesized study variations.
 */
export function exportPgnTree(
    treeNodes: Record<string, MoveTreeNode>,
    rootNodeId: string,
    options: {
        mainLineNodeIds?: string[];
        gameMode?: GameMode;
        opening?: string;
        label?: string;
        result?: GameResult;
        date?: string;
        startFen?: string;
    } = {}
): string | null {
    if (!hasTreeMoves(treeNodes, rootNodeId)) return null;

    const result = options.result ? RESULT_TAG[options.result] : '*';
    const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const startPosition = parsePgnStartPosition(options.startFen);

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        options.gameMode ? tagLine('Event', options.gameMode) : null,
        options.label ? tagLine('White', options.label) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${buildTreeMoveText(
        treeNodes,
        rootNodeId,
        startPosition,
        options.mainLineNodeIds ?? [],
        result
    )}\n`;
}

/**
 * Exports a game from raw UCI move strings (e.g. from game library).
 */
export function exportPgnFromUci(
    uciMoves: string[],
    options: {
        gameMode?: GameMode;
        opening?: string;
        result?: GameResult;
        label?: string;
        date?: string;
        startFen?: string;
    } = {}
): string {
    const result = options.result ? RESULT_TAG[options.result] : '*';
    const date = options.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const startPosition = parsePgnStartPosition(options.startFen);

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        options.gameMode ? tagLine('Event', options.gameMode) : null,
        options.label ? tagLine('White', options.label) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${buildMoveText(uciMoves, startPosition, result)}\n`;
}

export function exportPgnFromMoveTree(
    moveTree: SavedMoveTreeNode[],
    options: {
        mainLineMoves?: string[];
        gameMode?: GameMode;
        opening?: string;
        result?: GameResult;
        label?: string;
        date?: string;
        startFen?: string;
    } = {}
): string | null {
    const { rootNodeId, treeNodes } = savedMoveTreeToNodes(moveTree);
    const preferredNodeIds: string[] = [];
    let cursor = rootNodeId;
    for (const move of options.mainLineMoves ?? []) {
        const childId = treeNodes[cursor]?.childrenIds.find((id) => treeNodes[id]?.record?.uci === move);
        if (!childId) break;
        preferredNodeIds.push(childId);
        cursor = childId;
    }

    const pgn = exportPgnTree(treeNodes, rootNodeId, {
        mainLineNodeIds: preferredNodeIds,
        gameMode: options.gameMode,
        opening: options.opening,
        label: options.label,
        result: options.result,
        date: options.date,
        startFen: options.startFen,
    });
    return pgn;
}

/**
 * Copies text to clipboard, returning a promise that resolves to true on success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    const value = String(text);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    try {
        if (clipboard?.writeText) {
            await clipboard.writeText(value);
            return true;
        }
    } catch (_) {
        // Fall through to the selection-based fallback below.
    }

    return copyToClipboardWithSelection(value);
}

/**
 * Downloads plain text through a temporary object URL.
 */
export function downloadTextFile(filename: string, text: string, mimeType = 'text/plain;charset=utf-8'): boolean {
    if (
        typeof document === 'undefined' ||
        !document.body ||
        typeof Blob === 'undefined' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
    ) {
        return false;
    }

    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;

    try {
        const blob = new Blob([String(text)], { type: mimeType });
        url = URL.createObjectURL(blob);
        anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename || 'web-xiangqi-export.txt';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        return true;
    } catch (_) {
        return false;
    } finally {
        anchor?.remove();
        if (url) {
            const objectUrl = url;
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        }
    }
}

function copyToClipboardWithSelection(text: string): boolean {
    if (typeof document === 'undefined' || !document.body) return false;

    const previousActive = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const selection = document.getSelection?.();
    const ranges: Range[] = [];
    if (selection) {
        for (let i = 0; i < selection.rangeCount; i += 1) {
            ranges.push(selection.getRangeAt(i));
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();

    try {
        return Boolean(document.execCommand?.('copy'));
    } catch (_) {
        return false;
    } finally {
        textarea.remove();
        if (selection) {
            selection.removeAllRanges();
            for (const range of ranges) {
                selection.addRange(range);
            }
        }
        previousActive?.focus({ preventScroll: true });
    }
}
