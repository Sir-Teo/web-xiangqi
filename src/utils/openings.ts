// Xiangqi opening recognition — WXF/standard classification
// Move sequences are UCI strings from the starting position.
import {
    START_FEN,
    parseFenBoard,
    uciToSquare,
    validatePieceMove,
    type BoardState,
    type Side,
} from './xiangqi';

export interface OpeningEntry {
    name: string;
    chinese: string;
    moves: string[]; // UCI move sequence
}

export interface OpeningCandidate {
    move: string;
    count: number;
    names: string[];
    chinese: string[];
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
        moves: ['c3c4'],
    },
    {
        name: 'Pawn Opening — Pawn Counter',
        chinese: '仙人指路對挺卒',
        moves: ['c3c4', 'c6c5'],
    },
    {
        name: 'Pawn Opening — Cannon Reply',
        chinese: '仙人指路對中炮',
        moves: ['c3c4', 'h7e7'],
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
        name: 'Pawn Opening — Elephant Counter',
        chinese: '起兵對象',
        moves: ['c3c4', 'c9e7'],
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

    // ── Central Cannon vs Screen Horse — extended lines ────────────────────
    {
        name: 'Central Cannon vs Screen Horse — Right Straight Chariot',
        chinese: '中炮對屏風馬右直車',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'i0h0'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Left Ranked Chariot',
        chinese: '中炮對屏風馬左橫車',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'i9h9'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Horse Advance',
        chinese: '中炮對屏風馬右馬盤河',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'h0g2'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Counter Cannon',
        chinese: '中炮對屏風馬反炮',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'h0g2', 'h7e7'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Elephant Counter',
        chinese: '中炮對屏風馬飛象',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'c0a2', 'c9e7'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Both Straight Chariots',
        chinese: '中炮對屏風馬兩車直對',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'a9b9', 'i0h0', 'i9h9'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Quick Attack',
        chinese: '中炮急進',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'a9b9', 'b0b4'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Pawn Pressure',
        chinese: '中炮對屏風馬挺兵',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'g0g3'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Left Horse Attack',
        chinese: '中炮左馬盤河',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'b0a2'],
    },
    {
        name: 'Central Cannon — High Chariot',
        chinese: '中炮高車',
        moves: ['h2e2', 'h9g7', 'i0h0', 'b9c7'],
    },
    {
        name: 'Central Cannon — Left Chariot Right Horse',
        chinese: '中炮左車右馬',
        moves: ['h2e2', 'h9g7', 'a0b0', 'b9c7', 'h0g2'],
    },
    {
        name: 'Central Cannon vs Screen Horse — Cannon Pressure',
        chinese: '中炮七路炮對屏風馬',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'b2g2'],
    },

    // ── Sandwiched Horse Cannon (夾馬炮) variations ─────────────────────────
    {
        name: 'Sandwiched Horse Defence — Left Chariot',
        chinese: '夾馬炮左車',
        moves: ['h2e2', 'b9c7', 'b0c2', 'h9g7', 'a0b0'],
    },
    {
        name: 'Sandwiched Horse Defence — Right Chariot',
        chinese: '夾馬炮右車',
        moves: ['h2e2', 'b9c7', 'b0c2', 'h9g7', 'i0h0'],
    },
    {
        name: 'Sandwiched Horse Defence — Horse Counter',
        chinese: '夾馬炮對右馬',
        moves: ['h2e2', 'b9c7', 'h0g2', 'h9g7'],
    },
    {
        name: 'Sandwiched Horse Defence — Elephant Reply',
        chinese: '夾馬炮對象',
        moves: ['h2e2', 'b9c7', 'b0c2', 'c9e7'],
    },
    {
        name: 'Sandwiched Horse Defence — Cannon Counter',
        chinese: '夾馬炮對炮',
        moves: ['h2e2', 'b9c7', 'b0c2', 'b7e7'],
    },

    // ── Opposite-Direction Cannon (順炮) extended ──────────────────────────
    {
        name: 'Opposite-Direction Cannon — Straight Chariots',
        chinese: '順炮兩車直對',
        moves: ['h2e2', 'h7e7', 'i0h0', 'i9h9'],
    },
    {
        name: 'Opposite-Direction Cannon — Ranked Left Chariot',
        chinese: '順炮橫車對直車',
        moves: ['h2e2', 'h7e7', 'a0b0', 'i9h9'],
    },
    {
        name: 'Opposite-Direction Cannon — Horse Defence',
        chinese: '順炮對馬',
        moves: ['h2e2', 'h7e7', 'b0c2', 'h9g7'],
    },
    {
        name: 'Opposite-Direction Cannon — Double Horse',
        chinese: '順炮雙馬',
        moves: ['h2e2', 'h7e7', 'b0c2', 'h9g7', 'h0g2', 'b9c7'],
    },
    {
        name: 'Opposite-Direction Cannon — Screen Horse',
        chinese: '順炮屏風馬',
        moves: ['h2e2', 'h7e7', 'i0h0', 'h9g7', 'b0c2', 'b9c7'],
    },
    {
        name: 'Opposite-Direction Cannon — Left Ranked Chariot',
        chinese: '順炮橫車對橫車',
        moves: ['h2e2', 'h7e7', 'a0b0', 'a9b9'],
    },

    // ── Same-Direction Cannon (列炮) extended ─────────────────────────────
    {
        name: 'Same-Direction Cannon — Screen Horse Reply',
        chinese: '列炮對屏風馬',
        moves: ['h2e2', 'b7e7', 'b0c2', 'b9c7'],
    },
    {
        name: 'Same-Direction Cannon — Right Chariot',
        chinese: '列炮右車',
        moves: ['h2e2', 'b7e7', 'i0h0'],
    },
    {
        name: 'Same-Direction Cannon — Horse Counter',
        chinese: '列炮對馬',
        moves: ['h2e2', 'b7e7', 'b0c2', 'h9g7'],
    },
    {
        name: 'Same-Direction Cannon — Left Chariot',
        chinese: '列炮左車',
        moves: ['h2e2', 'b7e7', 'a0b0', 'b9c7'],
    },

    // ── Elephant Opening (飛象局) extended ─────────────────────────────────
    {
        name: 'Elephant Opening — Mirror Elephant',
        chinese: '飛象對飛象',
        moves: ['c0e2', 'c9e7'],
    },
    {
        name: 'Elephant Opening — Central Cannon Counter',
        chinese: '飛象對中炮',
        moves: ['c0e2', 'h7e7'],
    },
    {
        name: 'Elephant Opening — Horse Counter',
        chinese: '飛象對馬',
        moves: ['c0e2', 'h9g7'],
    },
    {
        name: 'Elephant Opening — Screen Horse',
        chinese: '飛象對屏風馬',
        moves: ['c0e2', 'h9g7', 'g0e2', 'b9c7'],
    },
    {
        name: 'Left Elephant Opening',
        chinese: '左飛象',
        moves: ['g0e2'],
    },
    {
        name: 'Both Elephants Opening',
        chinese: '雙飛象',
        moves: ['c0e2', 'c9e7', 'g0e2', 'g9e7'],
    },
    {
        name: 'Elephant Opening — Guard Counter',
        chinese: '飛象對士',
        moves: ['c0e2', 'd9e8'],
    },
    {
        name: 'Elephant Opening — Pawn Opening Counter',
        chinese: '飛象對仙人指路',
        moves: ['c0e2', 'c6c5'],
    },

    // ── Guard Opening (士角炮) extended ────────────────────────────────────
    {
        name: 'Guard Opening — Cannon Counter',
        chinese: '士角炮對中炮',
        moves: ['d0e1', 'h7e7'],
    },
    {
        name: 'Guard Opening — Horse Counter',
        chinese: '士角炮對馬',
        moves: ['d0e1', 'h9g7'],
    },
    {
        name: 'Guard Opening — Elephant Counter',
        chinese: '士角炮對象',
        moves: ['d0e1', 'c9e7'],
    },
    {
        name: 'Right Guard Opening',
        chinese: '右士角炮',
        moves: ['f0e1'],
    },

    // ── Horse Openings (起馬局) extended ───────────────────────────────────
    {
        name: 'Right Horse Opening',
        chinese: '右起馬',
        moves: ['h0g2'],
    },
    {
        name: 'Right Horse — Screen Horse Counter',
        chinese: '右馬對屏風馬',
        moves: ['h0g2', 'h9g7'],
    },
    {
        name: 'Right Horse — Central Cannon Counter',
        chinese: '右馬對中炮',
        moves: ['h0g2', 'h7e7'],
    },
    {
        name: 'Knight Opening — Central Cannon Counter',
        chinese: '起馬對中炮',
        moves: ['b0c2', 'h7e7'],
    },
    {
        name: 'Knight Opening — Horse + Cannon',
        chinese: '起馬對炮',
        moves: ['b0c2', 'h7e7', 'h2e2'],
    },
    {
        name: 'Knight Opening — Elephant Counter',
        chinese: '起馬對象',
        moves: ['b0c2', 'c9e7'],
    },
    {
        name: 'Knight Opening — Guard Counter',
        chinese: '起馬對士',
        moves: ['b0c2', 'd9e8'],
    },
    {
        name: 'Double Knight — Cannon Centre',
        chinese: '雙馬對中炮',
        moves: ['b0c2', 'b9c7', 'h0g2', 'h9g7', 'h2e2'],
    },

    // ── Pawn Opening (仙人指路) extended ───────────────────────────────────
    {
        name: 'Pawn Opening — Horse Counter',
        chinese: '仙人指路對馬',
        moves: ['c3c4', 'h9g7'],
    },
    {
        name: 'Pawn Opening — Screen Horse Counter',
        chinese: '仙人指路對屏風馬',
        moves: ['c3c4', 'b9c7'],
    },
    {
        name: 'Pawn Opening — Elephant Counter',
        chinese: '仙人指路對象',
        moves: ['c3c4', 'c9e7'],
    },
    {
        name: 'Right Pawn Opening',
        chinese: '右仙人指路',
        moves: ['g3g4'],
    },
    {
        name: 'High Pawn Opening',
        chinese: '挺兵',
        moves: ['e3e4'],
    },
    {
        name: 'High Pawn — Cannon Reply',
        chinese: '挺兵對炮',
        moves: ['e3e4', 'h7e7'],
    },

    // ── Guard Defence (反宮馬) extended ────────────────────────────────────
    {
        name: 'Guard Defence — Elephant Support',
        chinese: '反宮馬飛象',
        moves: ['h2e2', 'd9e8', 'b0c2', 'g9e7'],
    },
    {
        name: 'Guard Defence — Horse Counter',
        chinese: '反宮馬右馬',
        moves: ['h2e2', 'd9e8', 'b0c2', 'h9g7'],
    },
    {
        name: 'Guard Defence — Left Horse',
        chinese: '反宮馬左馬',
        moves: ['h2e2', 'd9e8', 'b0c2', 'b9a7'],
    },
    {
        name: 'Guard Defence — Cannon Counter',
        chinese: '反宮馬對炮',
        moves: ['h2e2', 'd9e8', 'h0g2', 'h7e7'],
    },

    // ── River Crossing Cannon (過河炮) extended ────────────────────────────
    {
        name: 'River Crossing Cannon — Screen Horse',
        chinese: '過河炮對屏風馬',
        moves: ['h2e2', 'h9g7', 'b2e2', 'b9c7'],
    },
    {
        name: 'River Crossing Cannon — Elephant Defence',
        chinese: '過河炮對象',
        moves: ['h2e2', 'h9g7', 'b2e2', 'c9e7'],
    },
    {
        name: 'River Crossing Cannon — Chariot Attack',
        chinese: '過河炮直車',
        moves: ['h2e2', 'h9g7', 'a0b0', 'b9c7', 'b2e2'],
    },

    // ── Cannon Charge (炮攻) and special formations ────────────────────────
    {
        name: 'Lateral Cannon',
        chinese: '橫炮',
        moves: ['h2d2'],
    },
    {
        name: 'Edge Cannon',
        chinese: '邊炮',
        moves: ['h2i2'],
    },
    {
        name: 'Edge Cannon — Edge Pawn Counter',
        chinese: '邊炮對邊兵',
        moves: ['h2i2', 'b9a7'],
    },
    {
        name: 'Central Cannon — Left Cannon',
        chinese: '中炮左炮',
        moves: ['h2e2', 'h9g7', 'b2d2'],
    },
    {
        name: 'Cannon — Pawn Advance Attack',
        chinese: '炮兵進攻',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'c3c4'],
    },
    {
        name: 'Central Cannon — Cannon Swap Gambit',
        chinese: '中炮兌炮',
        moves: ['h2e2', 'h7e7', 'e2e7'],
    },

    // ── Closed Openings / passive systems ─────────────────────────────────
    {
        name: 'Fortress Defence',
        chinese: '堡壘陣',
        moves: ['h2e2', 'd9e8', 'f0e1'],
    },
    {
        name: 'Iron Guard Defence',
        chinese: '鐵衛陣',
        moves: ['h2e2', 'd9e8', 'f9e8'],
    },
    {
        name: 'Turtle Back Formation',
        chinese: '龜背炮',
        moves: ['h2e2', 'b7d7', 'b0c2', 'h9g7'],
    },
    {
        name: 'Star Formation',
        chinese: '星形陣',
        moves: ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'd0e1', 'c9e7', 'f0e1'],
    },

    // ── Black first-move specials ──────────────────────────────────────────
    {
        name: 'Central Cannon — Pawn Counter',
        chinese: '中炮對仙人指路',
        moves: ['h2e2', 'c6c5'],
    },
    {
        name: 'Central Cannon — Edge Pawn Counter',
        chinese: '中炮對邊馬',
        moves: ['h2e2', 'i9i8'],
    },
    {
        name: 'Central Cannon — Guard Reply',
        chinese: '中炮對右士',
        moves: ['h2e2', 'f9e8'],
    },

    // ── Symmetrical openings ───────────────────────────────────────────────
    {
        name: 'Mirror Cannon Opening',
        chinese: '對中炮',
        moves: ['h2e2', 'b7e7', 'b2e2', 'h7e7'],
    },
    {
        name: 'Mirror Horse Opening',
        chinese: '對起馬',
        moves: ['b0c2', 'b9c7', 'h0g2', 'h9g7', 'a0b0', 'a9b9'],
    },
    {
        name: 'Mirror Pawn Opening',
        chinese: '對仙人指路',
        moves: ['c3c4', 'c6c5', 'g3g4', 'g6g5'],
    },
];

let playableOpeningsCache: OpeningEntry[] | null = null;

function applyOpeningMove(board: BoardState, uci: string, side: Side) {
    const from = uciToSquare(uci.substring(0, 2));
    const to = uciToSquare(uci.substring(2, 4));
    if (!from || !to) return null;

    const result = validatePieceMove(board, {
        fromFile: from.file,
        fromRank: from.rank,
        toFile: to.file,
        toRank: to.rank,
        raw: uci,
    }, side);
    if (!result.ok) return null;

    const nextBoard = board.map((row) => row.slice());
    nextBoard[to.rank][to.file] = result.piece || '';
    nextBoard[from.rank][from.file] = '';
    return nextBoard;
}

function isPlayableOpening(entry: OpeningEntry) {
    let board = parseFenBoard(START_FEN);
    let side: Side = 'w';

    for (const uci of entry.moves) {
        const nextBoard = applyOpeningMove(board, uci, side);
        if (!nextBoard) return false;
        board = nextBoard;
        side = side === 'w' ? 'b' : 'w';
    }

    return true;
}

function getPlayableOpenings() {
    if (!playableOpeningsCache) {
        playableOpeningsCache = OPENINGS.filter(isPlayableOpening);
    }
    return playableOpeningsCache;
}

/**
 * Find the longest named opening that matches a prefix of the given move history.
 * `moveHistory` is an array of UCI strings from the start of the game.
 */
export function matchOpening(moveHistory: string[]): OpeningEntry | null {
    if (moveHistory.length === 0) return null;

    let best: OpeningEntry | null = null;

    for (const entry of getPlayableOpenings()) {
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

export function getOpeningCandidates(moveHistory: string[], limit = 6): OpeningCandidate[] {
    const normalizedHistory = moveHistory.map((move) => String(move).toLowerCase());
    const byMove = new Map<string, { entries: OpeningEntry[]; longestLine: number }>();

    for (const entry of getPlayableOpenings()) {
        if (entry.moves.length <= normalizedHistory.length) continue;

        let prefixMatches = true;
        for (let index = 0; index < normalizedHistory.length; index += 1) {
            if (entry.moves[index] !== normalizedHistory[index]) {
                prefixMatches = false;
                break;
            }
        }
        if (!prefixMatches) continue;

        const nextMove = entry.moves[normalizedHistory.length];
        const current = byMove.get(nextMove);
        if (current) {
            current.entries.push(entry);
            current.longestLine = Math.max(current.longestLine, entry.moves.length);
        } else {
            byMove.set(nextMove, { entries: [entry], longestLine: entry.moves.length });
        }
    }

    return Array.from(byMove.entries())
        .map(([move, { entries, longestLine }]) => ({
            move,
            count: entries.length,
            names: Array.from(new Set(entries.map((entry) => entry.name))).slice(0, 3),
            chinese: Array.from(new Set(entries.map((entry) => entry.chinese))).slice(0, 3),
            longestLine,
        }))
        .sort((left, right) =>
            right.count - left.count ||
            right.longestLine - left.longestLine ||
            left.move.localeCompare(right.move)
        )
        .slice(0, Math.max(0, Math.trunc(limit)))
        .map(({ longestLine: _longestLine, ...candidate }) => candidate);
}
