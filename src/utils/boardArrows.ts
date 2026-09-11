import { uciToSquare } from './xiangqi';
import type { AssistMode } from './preferences';

export type BoardSquare = { file: number; rank: number };

export type BoardArrowKind = 'last' | 'engine' | 'engine-focus' | 'book' | 'threat' | 'user';

export type BoardArrow = {
    from: BoardSquare;
    to: BoardSquare;
    color: string;
    kind?: BoardArrowKind;
    opacity?: number;
    strokeWidth?: number;
};

/**
 * Every arrow the board can draw, in one place, because the board reads as a
 * single picture and these have to be legible against each other. The last
 * move is wide and dim so it sits behind; the thing the reader asked for --
 * a threat, a hint, a spotlit line -- is the widest and brightest; the book's
 * second suggestion is deliberately faint enough to read as a second.
 */
const STYLE = {
    last: { opacity: 0.82, strokeWidth: 5 },
    threat: { color: '#f43f5e', opacity: 0.92, strokeWidth: 6 },
    focus: { color: '#38bdf8', opacity: 0.95, strokeWidth: 7 },
    bookFirst: { color: '#f59e0b', opacity: 0.72, strokeWidth: 4.5 },
    bookRest: { color: '#fbbf24', opacity: 0.48, strokeWidth: 3.25 },
    engineBest: { color: '#10b981', opacity: 0.88, strokeWidth: 6 },
    engineAlt: { color: '#6ee7b7', opacity: 0.55, strokeWidth: 3.5 },
} as const;

/** How many book suggestions get an arrow. Pro asks for more of everything. */
const BOOK_ARROW_LIMIT: Record<AssistMode, number> = { coach: 2, pro: 3 };

/** The engine alternatives drawn beside the best move, by line index. */
const ALTERNATIVE_LINE_INDEXES = [1, 2] as const;

export type PvLineLike = { moves: readonly string[] };

export type BoardArrowInput = {
    /** The reader's master switch. Off means an empty board, their own arrows included. */
    showArrows: boolean;
    lastMove: { from: BoardSquare; to: BoardSquare; color: string } | null;
    threatMove: string | null;
    hintMove: string | null;
    /** A drill question is on screen and waiting for an answer. */
    drillAsking: boolean;
    engineEnabled: boolean;
    analysisPvLines: readonly PvLineLike[];
    /** The line the reader has singled out, or null. */
    spotlightPvIndex: number | null;
    spotlightPvLine: PvLineLike | null;
    openingCandidates: readonly { move: string }[];
    assistMode: AssistMode;
    userArrows: readonly BoardArrow[];
};

function arrowForUci(uci: string, style: { color: string; opacity: number; strokeWidth: number }, kind: BoardArrowKind): BoardArrow | null {
    const from = uciToSquare(uci.substring(0, 2));
    const to = uciToSquare(uci.substring(2, 4));
    if (!from || !to) return null;
    return { from, to, color: style.color, kind, opacity: style.opacity, strokeWidth: style.strokeWidth };
}

/**
 * Which arrows belong on the board right now.
 *
 * The order matters twice over: later arrows paint over earlier ones, and the
 * two early returns are rules rather than optimisations.
 *
 * - `showArrows` off draws nothing at all, the reader's own arrows included.
 *   It is the one switch that means "clear the board".
 * - While a drill is asking, everything the engine knows is withheld. A
 *   question with the answer drawn on the board is not a question. What the
 *   reader already asked to see -- the last move, a threat, a hint -- stays,
 *   and so do arrows they drew themselves.
 *
 * The engine section is gated once on `engineEnabled` rather than per branch.
 * The original had no such gate on the alternative lines, which could not
 * differ: `analysisPvLines` is empty whenever the engine is off. Gating it
 * once says so, instead of leaving a branch that disagrees with its siblings.
 */
export function buildBoardArrows(input: BoardArrowInput): BoardArrow[] {
    if (!input.showArrows) return [];
    const result: BoardArrow[] = [];

    if (input.lastMove) {
        result.push({ ...input.lastMove, kind: 'last', ...STYLE.last });
    }
    if (input.threatMove) {
        const arrow = arrowForUci(input.threatMove, STYLE.threat, 'threat');
        if (arrow) result.push(arrow);
    }
    if (input.hintMove) {
        const arrow = arrowForUci(input.hintMove, STYLE.focus, 'engine-focus');
        if (arrow) result.push(arrow);
    }

    if (input.drillAsking) return [...result, ...input.userArrows];

    const lines = input.engineEnabled ? input.analysisPvLines : [];
    const hasEngineMoveArrows = lines.some((pv) => pv.moves[0]);

    // The book answers "what is played here", which the engine's own line
    // already answers when it has one. Two answers to one question read as a
    // disagreement, so the book speaks only in the silence.
    if (!hasEngineMoveArrows) {
        input.openingCandidates.slice(0, BOOK_ARROW_LIMIT[input.assistMode]).forEach((candidate, index) => {
            const arrow = arrowForUci(candidate.move, index === 0 ? STYLE.bookFirst : STYLE.bookRest, 'book');
            if (arrow) result.push(arrow);
        });
    }

    // A spotlit line is drawn once, at the end, in its own colour -- so the
    // index it came from is skipped here rather than drawn over.
    if (input.spotlightPvIndex !== 0 && lines[0]?.moves[0]) {
        const arrow = arrowForUci(lines[0].moves[0], STYLE.engineBest, 'engine');
        if (arrow) result.push(arrow);
    }
    for (const index of ALTERNATIVE_LINE_INDEXES) {
        if (input.spotlightPvIndex === index) continue;
        const uci = lines[index]?.moves[0];
        if (!uci) continue;
        const arrow = arrowForUci(uci, STYLE.engineAlt, 'engine');
        if (arrow) result.push(arrow);
    }
    if (input.engineEnabled && input.spotlightPvLine?.moves[0]) {
        const arrow = arrowForUci(input.spotlightPvLine.moves[0], STYLE.focus, 'engine-focus');
        if (arrow) result.push(arrow);
    }

    return [...result, ...input.userArrows];
}

/**
 * A per-board, one-result cache. Engine scores and PV tails can change without
 * changing any drawn arrow. Compare the complete drawing data so new colors,
 * styles, ordering, and endpoints still reach the board. Forgetting this cache
 * only costs a render; it never changes the result of the pure builder.
 */
export function createBoardArrowSelector() {
    let previousKey: string | undefined;
    let previous: BoardArrow[] = [];
    return (input: BoardArrowInput): BoardArrow[] => {
        const next = buildBoardArrows(input);
        const key = JSON.stringify(next);
        if (key !== previousKey) { previousKey = key; previous = next; }
        return previous;
    };
}
