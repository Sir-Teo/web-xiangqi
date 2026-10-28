import { formatEvaluationText, mateDistanceFromScore, type EvaluationScoreKind } from './engineEvalReading';
import type { SavedGame, SavedMoveTreeNode } from './gameLibrary';
import { studyAnalysisEffort, type StudyAnalysis } from './studyAnalysis';
import { describeMoveGlyphs } from './moveGlyphs';

/** Search the displayed score, with a raw cp alias only for centipawn scores. */
export function evaluationSearchText(score: number | undefined, kind?: EvaluationScoreKind): string {
    if (score === undefined) return '';
    const display = formatEvaluationText(score, 2, kind);
    if (display === null) return '';
    const centipawns = mateDistanceFromScore(score, kind) === null ? ` ${score}cp` : '';
    return `${display}${centipawns} evaluation`;
}

function savedAnalysisSearchText(analysis: StudyAnalysis): string {
    const parts = [
        'saved analysis', evaluationSearchText(analysis.score, analysis.scoreKind), 'Red POV',
        analysis.bounded
            ? analysis.bound ? `${analysis.bound} bound ${analysis.bound}bound not exact` : 'bound not exact'
            : 'exact search score',
        `D${analysis.depth} depth ${analysis.depth}`, analysis.engine.name, analysis.engine.variant,
        `${analysis.engine.threads} thread${analysis.engine.threads === 1 ? '' : 's'}`,
        `${analysis.engine.hashMB} MB hash ${analysis.engine.hashMB}MB`,
        `MultiPV ${analysis.multiPv}`,
        analysis.candidates ? `Selected candidates ${analysis.candidates.join(' ')}` : 'All legal moves',
        analysis.position, studyAnalysisEffort(analysis),
    ];
    // Accept the rendered localized counters and ungrouped engine notation.
    if (analysis.effort?.nodes !== undefined) parts.push(`${analysis.effort.nodes} nodes`);
    if (analysis.effort?.timeMs !== undefined) parts.push(`${analysis.effort.timeMs} ms ${analysis.effort.timeMs}ms`);
    return parts.join(' ');
}

function savedNodeSearchText(node: SavedMoveTreeNode): string {
    const parts = [node.uci];
    if (node.comment) parts.push(node.comment);
    if (node.analysis) parts.push(savedAnalysisSearchText(node.analysis));
    if (node.quality) parts.push(node.quality);
    if (node.nags?.length) parts.push(describeMoveGlyphs(node.nags), ...node.nags.map(code => `$${code}`));
    const score = evaluationSearchText(node.evalScore, node.evalScoreKind);
    if (score) parts.push(score);
    return parts.join(' ');
}

export interface SavedStudySearchEntry {
    node: SavedMoveTreeNode;
    parent?: SavedStudySearchEntry;
    ply: number;
    text: string;
    siblingIndex: number;
}

/** On-demand move lookup: shared parent links keep deep studies linear in size. */
export function savedStudySearchEntries(nodes: SavedGame['moveTree']): SavedStudySearchEntry[] {
    const entries: SavedStudySearchEntry[] = [];
    const pending: { nodes: SavedMoveTreeNode[]; index: number; parent?: SavedStudySearchEntry }[] = [{ nodes: nodes ?? [], index: 0 }];
    while (pending.length) {
        const frame = pending[pending.length - 1];
        const node = frame.nodes[frame.index++];
        if (!node) { pending.pop(); continue; }
        const entry = { node, parent: frame.parent, ply: (frame.parent?.ply ?? 0) + 1,
            siblingIndex: frame.index - 1, text: savedNodeSearchText(node).toLowerCase() };
        entries.push(entry);
        if (node.children?.length) pending.push({ nodes: node.children, index: 0, parent: entry });
    }
    return entries;
}

/** Reconstruct only the path the reader chooses to inspect or open. */
export function savedStudyMatchMoves(entry: SavedStudySearchEntry): string[] {
    const moves: string[] = [];
    for (let cursor: SavedStudySearchEntry | undefined = entry; cursor; cursor = cursor.parent) moves.push(cursor.node.uci);
    return moves.reverse();
}

export function savedStudyMatchPath(entry: SavedStudySearchEntry): number[] {
    const path: number[] = [];
    for (let cursor: SavedStudySearchEntry | undefined = entry; cursor; cursor = cursor.parent) path.push(cursor.siblingIndex);
    return path.reverse();
}

/** Called once per saved-game object by the library's lazy search cache. */
export function savedTreeSearchText(nodes: SavedGame['moveTree']): string {
    const parts: string[] = [];
    const pending = [...nodes ?? []];
    while (pending.length) {
        const node = pending.pop()!;
        parts.push(savedNodeSearchText(node));
        if (node.children) pending.push(...node.children);
    }
    return parts.join(' ');
}
