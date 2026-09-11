import { recordedResultPgn, RESULT_TAG, type RecordedResult } from './recordedResult';
import { normalizeMoveComment } from './moveComment';
import { normalizeGameMetadata, type GameMetadata } from './gameMetadata';
import { normalizeMoveEvaluation } from './moveEvaluation';
import type { MoveRecord, MoveTreeNode } from '../hooks/useXiangqi';
import type { GameResult } from '../hooks/useXiangqi';
import type { GameMode } from '../App';
import type { SavedMoveTreeNode } from './gameLibrary';
import { START_FEN, parseFenBoard, validateMoveStr, hasAnyLegalMove, type Side } from './xiangqi';
import { annotationTokensForMove, type MoveAnnotationInput } from './pgnAnnotations';

function rootCommentText(comment?: string, result?: RecordedResult): string {
    const note = [recordedResultPgn(result), normalizeMoveComment(comment)].filter(Boolean).join(' ');
    return note ? `{ ${note} }\n` : '';
}

const DEFAULT_START_POSITION_FEN = `${START_FEN} w - - 0 1`;

type PgnSide = 'w' | 'b';

interface PgnStartPosition {
    fen: string;
    sideToMove: PgnSide;
    fullmove: number;
    isCustom: boolean;
}

/**
 * Today, where the player is, in the `YYYY.MM.DD` the PGN Date tag wants.
 *
 * `toISOString()` is UTC, and the PGN spec asks for the local date of the site.
 * Anywhere west of Greenwich that means an evening game is stamped tomorrow:
 * at UTC-4, everything exported after 8pm carried the next day's date. The
 * three exporters each wrote the same `toISOString().slice(0, 10)` expression,
 * so it was wrong in three places and could only be fixed in three places.
 */
export function formatPgnDate(date: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
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

/**
 * The move text, with each move's review written after it when there is one.
 *
 * A black half-move joins the pair its red half started, which is why this
 * appends rather than always pushing -- and an annotation goes on the end of
 * whichever entry the move itself landed in, so glyph and comment stay with
 * their move rather than drifting to the front of the next pair.
 */
function buildMoveText(
    moves: Array<{ uci: string } & MoveAnnotationInput>,
    startPosition: PgnStartPosition,
    result: string
): string {
    const movePairs: string[] = [];
    let sideToMove = startPosition.sideToMove;
    let moveNumber = startPosition.fullmove;

    for (const move of moves) {
        const annotated = [move.uci, ...annotationTokensForMove(move)].join(' ');
        if (sideToMove === 'w') {
            movePairs.push(`${moveNumber}. ${annotated}`);
        } else {
            const whiteHalfMovePrefix = `${moveNumber}. `;
            if (movePairs.length > 0 && movePairs[movePairs.length - 1].startsWith(whiteHalfMovePrefix)) {
                movePairs[movePairs.length - 1] += ` ${annotated}`;
            } else {
                movePairs.push(`${moveNumber}... ${annotated}`);
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
        const moveToken = [
            formatPgnMove(record.uci, startPosition, plyIndex, forceMoveNumber),
            ...annotationTokensForMove(record),
        ].join(' ');
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
                record: { recordedResult: child.recordedResult, uci: child.uci, comment: child.comment, analysis: child.analysis, ...normalizeMoveEvaluation(child) } as MoveRecord,
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
        metadata?: GameMetadata;
        gameMode?: GameMode;
        opening?: string;
        label?: string;
        result?: GameResult;
        date?: string;
        startFen?: string;
        rootComment?: string;
        rootResult?: RecordedResult;
        mainLinePinned?: boolean;
    } = {}
): string {
    const outcome = options.result ?? moves.at(-1)?.recordedResult ?? (moves.length ? undefined : options.rootResult);
    const result = outcome ? RESULT_TAG[outcome] : '*';
    const metadata = normalizeGameMetadata(options.metadata);
    const date = metadata?.date ?? options.date ?? formatPgnDate();
    const startPosition = parsePgnStartPosition(options.startFen);

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        metadata?.event || options.gameMode ? tagLine('Event', metadata?.event ?? options.gameMode!) : null,
        metadata?.redPlayer || options.label ? tagLine('White', metadata?.redPlayer ?? options.label!) : null,
        metadata?.blackPlayer ? tagLine('Black', metadata.blackPlayer) : null,
        metadata?.site ? tagLine('Site', metadata.site) : null,
        metadata?.round ? tagLine('Round', metadata.round) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        options.mainLinePinned ? tagLine('XiangqiMainLine', '1') : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${rootCommentText(options.rootComment, options.rootResult)}${buildMoveText(moves, startPosition, result)}\n`;
}

/** Position-derived outcome of the exported line, never a different viewed branch. */
function pinnedLineResult(tree: Record<string, MoveTreeNode>, line: string[], fen: string): GameResult {
    const last = tree[line[line.length - 1]]?.record;
    if (last?.board?.length === 10) {
        return hasAnyLegalMove(last.board, last.sideToMove) ? null : last.sideToMove === 'w' ? 'black-wins' : 'red-wins';
    }
    // Saved trees contain coordinates and annotations rather than board snapshots.
    try {
        let board = parseFenBoard(fen.split(/\s+/)[0]);
        let side: Side = fen.split(/\s+/)[1] === 'b' ? 'b' : 'w';
        for (const id of line) {
            const checked = validateMoveStr(tree[id].record!.uci, board, side);
            if (!checked.ok || !checked.mv) return null;
            const { fromRank, fromFile, toRank, toFile } = checked.mv;
            board = board.map(row => [...row]);
            board[toRank][toFile] = board[fromRank][fromFile];
            board[fromRank][fromFile] = '';
            side = side === 'w' ? 'b' : 'w';
        }
        return hasAnyLegalMove(board, side) ? null : side === 'w' ? 'black-wins' : 'red-wins';
    } catch { return null; }
}

/**
 * Exports the full move tree as PGN with sibling branches preserved as variations.
 * An explicit pin uses first-child order; otherwise the provided main line is
 * primary. Other legal children become
 * parenthesized study variations.
 */
export function exportPgnTree(
    treeNodes: Record<string, MoveTreeNode>,
    rootNodeId: string,
    options: {
        mainLineNodeIds?: string[];
        metadata?: GameMetadata;
        gameMode?: GameMode;
        opening?: string;
        label?: string;
        result?: GameResult;
        date?: string;
        startFen?: string;
        rootComment?: string;
        rootResult?: RecordedResult;
        mainLinePinned?: boolean;
    } = {}
): string | null {
    if (!hasTreeMoves(treeNodes, rootNodeId)) return null;

    const mainLinePinned = options.mainLinePinned ?? treeNodes[rootNodeId]?.mainLinePinned;
    const metadata = normalizeGameMetadata(options.metadata);
    const date = metadata?.date ?? options.date ?? formatPgnDate();
    const startPosition = parsePgnStartPosition(options.startFen);
    const preferred = buildPreferredChildMap(mainLinePinned ? [] : options.mainLineNodeIds ?? [], treeNodes);
    const primaryIds: string[] = [];
    const seen = new Set([rootNodeId]);
    let parent = rootNodeId;
    while (treeNodes[parent]?.childrenIds.length) {
        const wanted = preferred.get(parent);
        const id = wanted && treeNodes[parent].childrenIds.includes(wanted) ? wanted : treeNodes[parent].childrenIds[0];
        if (seen.has(id) || !treeNodes[id]?.record || treeNodes[id].parentId !== parent) break;
        primaryIds.push(id); seen.add(id); parent = id;
    }
    const declared = treeNodes[primaryIds.at(-1) ?? rootNodeId]?.record?.recordedResult;
    const selectedIsMain = options.mainLineNodeIds?.length === primaryIds.length
        && primaryIds.every((id, index) => id === options.mainLineNodeIds?.[index]);
    const outcome = mainLinePinned || declared
        ? pinnedLineResult(treeNodes, primaryIds, startPosition.fen) ?? declared ?? (selectedIsMain ? options.result : undefined)
        : options.result;
    const result = outcome ? RESULT_TAG[outcome] : '*';

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        metadata?.event || options.gameMode ? tagLine('Event', metadata?.event ?? options.gameMode!) : null,
        metadata?.redPlayer || options.label ? tagLine('White', metadata?.redPlayer ?? options.label!) : null,
        metadata?.blackPlayer ? tagLine('Black', metadata.blackPlayer) : null,
        metadata?.site ? tagLine('Site', metadata.site) : null,
        metadata?.round ? tagLine('Round', metadata.round) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        mainLinePinned ? tagLine('XiangqiMainLine', '1') : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${rootCommentText(options.rootComment ?? treeNodes[rootNodeId]?.comment, options.rootResult ?? treeNodes[rootNodeId]?.recordedResult)}${buildTreeMoveText(
        treeNodes,
        rootNodeId,
        startPosition,
        mainLinePinned ? [] : options.mainLineNodeIds ?? [],
        result
    )}\n`;
}

/**
 * Exports a game from raw UCI move strings (e.g. from game library).
 */
export function exportPgnFromUci(
    uciMoves: string[],
    options: {
        metadata?: GameMetadata;
        gameMode?: GameMode;
        opening?: string;
        result?: GameResult;
        label?: string;
        date?: string;
        startFen?: string;
        rootComment?: string;
        rootResult?: RecordedResult;
        mainLinePinned?: boolean;
    } = {}
): string {
    const outcome = options.result ?? (uciMoves.length ? undefined : options.rootResult);
    const result = outcome ? RESULT_TAG[outcome] : '*';
    const metadata = normalizeGameMetadata(options.metadata);
    const date = metadata?.date ?? options.date ?? formatPgnDate();
    const startPosition = parsePgnStartPosition(options.startFen);

    const tags = [
        tagLine('Variant', 'Xiangqi'),
        tagLine('Date', date),
        metadata?.event || options.gameMode ? tagLine('Event', metadata?.event ?? options.gameMode!) : null,
        metadata?.redPlayer || options.label ? tagLine('White', metadata?.redPlayer ?? options.label!) : null,
        metadata?.blackPlayer ? tagLine('Black', metadata.blackPlayer) : null,
        metadata?.site ? tagLine('Site', metadata.site) : null,
        metadata?.round ? tagLine('Round', metadata.round) : null,
        options.opening ? tagLine('Opening', options.opening) : null,
        startPosition.isCustom ? tagLine('SetUp', '1') : null,
        startPosition.isCustom ? tagLine('FEN', startPosition.fen) : null,
        options.mainLinePinned ? tagLine('XiangqiMainLine', '1') : null,
        tagLine('Result', result),
    ].filter(Boolean).join('\n');

    return `${tags}\n\n${rootCommentText(options.rootComment, options.rootResult)}${buildMoveText(uciMoves.map((uci) => ({ uci })), startPosition, result)}\n`;
}

export function exportPgnFromMoveTree(
    moveTree: SavedMoveTreeNode[],
    options: {
        mainLineMoves?: string[];
        metadata?: GameMetadata;
        gameMode?: GameMode;
        opening?: string;
        result?: GameResult;
        label?: string;
        date?: string;
        startFen?: string;
        rootComment?: string;
        rootResult?: RecordedResult;
        mainLinePinned?: boolean;
    } = {}
): string | null {
    const { rootNodeId, treeNodes } = savedMoveTreeToNodes(moveTree);
    const preferredNodeIds: string[] = [];
    const mainLineMoves = options.mainLineMoves ?? [];
    let cursor = rootNodeId;
    for (const move of mainLineMoves) {
        const childId = treeNodes[cursor]?.childrenIds.find((id) => treeNodes[id]?.record?.uci === move);
        if (!childId) return null;
        preferredNodeIds.push(childId);
        cursor = childId;
    }

    const pgn = exportPgnTree(treeNodes, rootNodeId, {
        mainLineNodeIds: preferredNodeIds,
        metadata: options.metadata,
        gameMode: options.gameMode,
        opening: options.opening,
        label: options.label,
        result: options.result,
        date: options.date,
        startFen: options.startFen,
        rootComment: options.rootComment,
        rootResult: options.rootResult,
        mainLinePinned: options.mainLinePinned,
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
