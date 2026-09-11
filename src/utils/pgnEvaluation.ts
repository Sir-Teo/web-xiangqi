import { evaluationKindOverride, MATE_SCORE_BASE } from './engineEvalReading';
import { normalizeEvalDepth, type MoveEvaluation } from './moveEvaluation';
import type { ReviewMoveQuality } from './review';

type PgnEvaluation = Pick<MoveEvaluation, 'evalScore' | 'evalDepth' | 'evalScoreKind'>;

/** Only the three PGN glyphs that map to this app's move-quality scale. */
export function parsePgnMoveQuality(token: string): ReviewMoveQuality | undefined {
    switch (token) {
        case '$6': case '?!': return 'inaccuracy';
        case '$2': case '?': return 'mistake';
        case '$4': case '??': return 'blunder';
        default: return undefined;
    }
}

function* evaluationCommands(comment: string): Generator<{ match: RegExpMatchArray; evaluation: PgnEvaluation }> {
    // Source order, signed pawn decimals or mate distances, optional depth.
    const commands = /\[%eval\s+(?:#([+-]?\d+)|([+-]?(?:\d+(?:\.\d*)?|\.\d+)))(?:,(\d+))?\s*\]/gi;
    for (const match of comment.matchAll(commands)) {
        const evalDepth = match[3] === undefined ? undefined : normalizeEvalDepth(Number(match[3]));
        const depth = evalDepth === undefined ? {} : { evalDepth };
        if (match[1] !== undefined) {
            const distance = Math.abs(Number(match[1]));
            // Larger distances cannot fit the legacy mate encoding safely.
            if (!Number.isSafeInteger(distance) || distance > MATE_SCORE_BASE / 2) continue;
            yield { match, evaluation: { evalScore: match[1].startsWith('-') ? -(MATE_SCORE_BASE - distance) : MATE_SCORE_BASE - distance, ...depth } };
        } else {
            const score = Math.round(Number(match[2]) * 100);
            if (!Number.isSafeInteger(score)) continue;
            const evalScoreKind = evaluationKindOverride(score, 'cp');
            yield { match, evaluation: { evalScore: score, ...depth, ...(evalScoreKind ? { evalScoreKind } : {}) } };
        }
    }
}

/** First valid evaluation within a comment, as in the ordinary PGN importer. */
export function parseEvalCommand(comment: string): PgnEvaluation | undefined {
    for (const { evaluation } of evaluationCommands(comment)) return evaluation;
    return undefined;
}

/** Extract supported scores; preserve invalid/unknown commands as note text. */
export function extractPgnEvalCommands(comment: string): { evaluation?: PgnEvaluation; prose: string } {
    let evaluation: PgnEvaluation | undefined;
    let cursor = 0;
    const parts: string[] = [];
    for (const entry of evaluationCommands(comment)) {
        evaluation ??= entry.evaluation;
        parts.push(comment.slice(cursor, entry.match.index), ' ');
        cursor = entry.match.index! + entry.match[0].length;
    }
    parts.push(comment.slice(cursor));
    return { evaluation, prose: parts.join('') };
}
