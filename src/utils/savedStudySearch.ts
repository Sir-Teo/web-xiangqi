import { formatEvaluationText, mateDistanceFromScore, type EvaluationScoreKind } from './engineEvalReading';
import type { SavedGame } from './gameLibrary';

/** Search the displayed score, with a raw cp alias only for centipawn scores. */
export function evaluationSearchText(score: number | undefined, kind?: EvaluationScoreKind): string {
    if (score === undefined) return '';
    const display = formatEvaluationText(score, 2, kind);
    if (display === null) return '';
    const centipawns = mateDistanceFromScore(score, kind) === null ? ` ${score}cp` : '';
    return `${display}${centipawns} evaluation`;
}

/** Called once per saved-game object by the library's lazy search cache. */
export function savedTreeSearchText(nodes: SavedGame['moveTree']): string {
    const parts: string[] = [];
    const pending = [...nodes ?? []];
    while (pending.length) {
        const node = pending.pop()!;
        parts.push(node.uci);
        if (node.comment) parts.push(node.comment);
        if (node.quality) parts.push(node.quality);
        const score = evaluationSearchText(node.evalScore, node.evalScoreKind);
        if (score) parts.push(score);
        if (node.children) pending.push(...node.children);
    }
    return parts.join(' ');
}
