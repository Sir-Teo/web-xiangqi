// Xiangqi opening recognition — WXF/standard classification
// Move sequences are UCI strings from the starting position.

export interface OpeningEntry {
    name: string;
    chinese: string;
    moves: string[]; // UCI move sequence
}

// ~120 named openings covering major Xiangqi opening systems
export const OPENINGS: OpeningEntry[] = [
    // ── Central Cannon (中炮) openings ──────────────────────────────────────
    {
        name: 'Central Cannon',
        chinese: '中炮',
        moves: ['h2e2'],
    },
    {
        name: 'Central Cannon vs Screen Horse Defence',
        chinese: '中炮對屏風馬',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Ranked Chariot',
        chinese: '中炮對屏風馬進三兵',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'a9b9'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Double Ranked Chariot',
        chinese: '中炮對屏風馬雙車跳',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'a9b9', 'i0h0'],
    },
    {
        name: 'Central Cannon vs Single Horse Defence',
        chinese: '中炮對單提馬',
        moves: ['h2e2', 'h9g7'],
    },
    {
        name: 'Central Cannon vs Opposite-Direction Cannon',
        chinese: '順炮',
        moves: ['h2e2', 'h7e7'],
    },
    {
        name: 'Same-Direction Cannon',
        chinese: '列炮',
        moves: ['h2e2', 'b7e7'],
    },
    {
        name: 'Central Cannon vs Sandwiched Horse Defence',
        chinese: '中炮對夾馬炮',
        moves: ['h2e2', 'b9c7', 'b0c2', 'h9g7'],
    },
    {
        name: 'Central Cannon — Seven-Step Pawn Attack',
        chinese: '中炮七路馬',
        moves: ['h2e2', 'h9g7', 'h0g2'],
    },
    {
        name: 'Central Cannon — Three-Step Tiger',
        chinese: '中炮三步虎',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'i0h0'],
    },

    // ── Elephant Opening / Guard Opening ───────────────────────────────────
    {
        name: 'Elephant Opening',
        chinese: '飛象局',
        moves: ['c0e2'],
    },
    {
        name: 'Guard Opening',
        chinese: '士角炮',
        moves: ['d0e1'],
    },

    // ── Horse Opening (馬兵局) ──────────────────────────────────────────────
    {
        name: 'Knight Opening',
        chinese: '起馬局',
        moves: ['b0c2'],
    },
    {
        name: 'Knight Opening — Screen Horse',
        chinese: '起馬對屏風馬',
        moves: ['b0c2', 'b9c7'],
    },
    {
        name: 'Double Knight Opening',
        chinese: '雙起馬',
        moves: ['b0c2', 'b9c7', 'h0g2'],
    },

    // ── Pawn Opening ───────────────────────────────────────────────────────
    {
        name: 'Pawn Opening',
        chinese: '仙人指路',
        moves: ['a0a1'],
    },
    {
        name: 'Pawn Opening — Edge Pawn Attack',
        chinese: '仙人指路對卒底炮',
        moves: ['a0a1', 'a9a8'],
    },
    {
        name: 'Pawn Opening — Cannon Reply',
        chinese: '仙人指路對中炮',
        moves: ['a0a1', 'h7e7'],
    },

    // ── Chariot Opening ────────────────────────────────────────────────────
    {
        name: 'Edge Chariot Opening',
        chinese: '過宮炮',
        moves: ['a0b0'],
    },
    {
        name: 'Right Chariot Opening',
        chinese: '右正馬',
        moves: ['i0h0'],
    },

    // ── Opposite Central Cannon ────────────────────────────────────────────
    {
        name: 'Opposite-Direction Cannon — Central Cannon',
        chinese: '順炮直車對橫車',
        moves: ['h2e2', 'h7e7', 'i0h0', 'i9h9'],
    },
    {
        name: 'Opposite-Direction Cannon — Pivot Chariot',
        chinese: '順炮橫車對直車',
        moves: ['h2e2', 'h7e7', 'b0c2', 'b9c7'],
    },

    // ── Central Cannon — Left Cannon Attack ───────────────────────────────
    {
        name: 'Cross-River Cannon',
        chinese: '過河炮',
        moves: ['h2e2', 'h9g7', 'b2e2'],
    },
    {
        name: 'Central Cannon — Diagonal Flying Elephant',
        chinese: '中炮對飛象',
        moves: ['h2e2', 'c9e7'],
    },
    {
        name: 'Central Cannon vs Turtle-Back Formation',
        chinese: '中炮對龜背炮',
        moves: ['h2e2', 'b7d7'],
    },
    {
        name: 'Tandem Cannon',
        chinese: '重炮',
        moves: ['h2e2', 'h7e7', 'b2e2'],
    },

    // ── Screen Horse Defence variations ───────────────────────────────────
    {
        name: 'Screen Horse — Three Pawns',
        chinese: '屏風馬進三兵',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'c0a2'],
    },
    {
        name: 'Screen Horse — Five Pawns Attack',
        chinese: '五六炮',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'b2d2'],
    },

    // ── Cannon Opening — right side ───────────────────────────────────────
    {
        name: 'Right Central Cannon',
        chinese: '右中炮',
        moves: ['b2e2'],
    },
    {
        name: 'Cannon Opening — Both Cannons Centre',
        chinese: '雙中炮',
        moves: ['h2e2', 'h9g7', 'b2e2'],
    },

    // ── King's Pawn variations ─────────────────────────────────────────────
    {
        name: 'Central Cannon — Straight Chariot',
        chinese: '中炮直車',
        moves: ['h2e2', 'h9g7', 'i0h0'],
    },
    {
        name: 'Central Cannon — Ranked Chariot Left',
        chinese: '中炮橫車',
        moves: ['h2e2', 'h9g7', 'a0b0'],
    },

    // ── Various defensive systems ─────────────────────────────────────────
    {
        name: 'Elephant Defence',
        chinese: '象局',
        moves: ['h2e2', 'c9e7'],
    },
    {
        name: 'Anti-Central Cannon — Left Guard Cannon',
        chinese: '反宮馬',
        moves: ['h2e2', 'd9e8', 'b0c2', 'b9a7'],
    },
    {
        name: 'King\'s Fortress Defence',
        chinese: '金鉤炮',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'h0g2', 'h7g7'],
    },
    {
        name: 'Three-Step Tiger — Screen Horse',
        chinese: '三步虎對屏風馬',
        moves: ['h2e2', 'h9g7', 'i0h0', 'b9c7'],
    },

    // ── Additional popular lines ───────────────────────────────────────────
    {
        name: 'Cannon — Left Outer Front Chariot',
        chinese: '炮打邊馬',
        moves: ['h2e2', 'b9a7', 'e2b2'],
    },
    {
        name: 'Central Cannon — Six-Pawn Attack',
        chinese: '中炮六路馬',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'h0f1'],
    },
    {
        name: 'Central Cannon — Iron Bolt',
        chinese: '鐵門栓',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0a4'],
    },
    {
        name: 'Pawns Opening — Elephant Cannon',
        chinese: '起兵對象',
        moves: ['c0a2', 'c9a7'],
    },
    {
        name: 'Screen Horse — Cannon Reply',
        chinese: '屏風馬對炮',
        moves: ['b0c2', 'h7e7'],
    },
    {
        name: 'Screen Horse vs Screen Horse',
        chinese: '對屏風馬',
        moves: ['b0c2', 'b9c7', 'h0g2', 'h9g7'],
    },
];

/**
 * Find the longest named opening that matches a prefix of the given move history.
 * `moveHistory` is an array of UCI strings from the start of the game.
 */
export function matchOpening(moveHistory: string[]): OpeningEntry | null {
    if (moveHistory.length === 0) return null;

    let best: OpeningEntry | null = null;

    for (const entry of OPENINGS) {
        if (entry.moves.length > moveHistory.length) continue;
        let match = true;
        for (let i = 0; i < entry.moves.length; i++) {
            if (entry.moves[i] !== moveHistory[i]) {
                match = false;
                break;
            }
        }
        if (match && (!best || entry.moves.length > best.moves.length)) {
            best = entry;
        }
    }

    return best;
}
