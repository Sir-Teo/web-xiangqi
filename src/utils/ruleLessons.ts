import { boardToFen, parseFenBoard, uciToSquare, validateMoveStr } from './xiangqi';
import { formatMoveRuleHint } from './moveRuleHints';
import { getLocalStorage, readStorage, writeStorage, type KeyValueStorage } from './storage';
import { RULE_LESSONS_STORAGE_KEY } from './storageKeys';

function position(pieces: Record<string, string>, blackGeneral = 'd9') {
    const board = Array.from({ length: 10 }, () => Array<string>(9).fill(''));
    for (const [square, piece] of Object.entries({ e0: 'K', [blackGeneral]: 'k', ...pieces })) {
        const point = uciToSquare(square)!; board[point.rank][point.file] = piece;
    }
    return boardToFen(board, 'w');
}

// Original teaching positions, checked against the same legality rules as play.
export const RULE_LESSONS = [
    { id: 'chariot', title: 'Chariot: clear lines', fen: position({ a4: 'R', a7: 'n' }), solution: 'a4a7',
      rule: 'A chariot travels along a rank or file. Pieces block its path.', task: 'Capture the black horse on a7 with the chariot on a4.',
      hint: 'The a-file is clear between the chariot and the horse.', success: 'The chariot captures by landing on the horse’s point.' },
    { id: 'horse', title: 'Horse: a blocked leg', fen: position({ e4: 'N', e5: 'P' }), solution: 'e4g5',
      rule: 'A horse moves in an L shape. A piece beside it can block the first step.', task: 'Move the horse from e4 to g5, using its clear right-hand path.',
      hint: 'The soldier on e5 blocks the upward path to f6. The first step toward g5 is f4.', success: 'The clear leg on f4 allows this horse move. Horses cannot jump over a blocked leg.' },
    { id: 'cannon', title: 'Cannon: one screen', fen: position({ e4: 'C', e6: 'P', e8: 'r' }), solution: 'e4e8',
      rule: 'A cannon captures across exactly one intervening piece, called a screen. Ordinary moves need a clear path.', task: 'Capture the black chariot on e8 with the cannon on e4.',
      hint: 'Use the soldier on e6 as the single screen.', success: 'One screen makes the capture possible. Its color does not matter.' },
    { id: 'elephant', title: 'Elephant: stay home', fen: position({ c4: 'B' }), solution: 'c4a2',
      rule: 'An elephant moves two points diagonally, with an empty midpoint. It stays on its own side of the river.', task: 'Move the elephant from c4 back to a2.',
      hint: 'b3 is clear. Moving toward e6 would cross the river.', success: 'The elephant stays on Red’s side, using the clear midpoint b3.' },
    { id: 'advisor', title: 'Advisor: palace diagonals', fen: position({ d0: 'A' }), solution: 'd0e1',
      rule: 'An advisor takes one diagonal step and remains inside the palace.', task: 'Move the advisor from d0 to the palace center, e1.',
      hint: 'Follow the diagonal line drawn inside the palace.', success: 'The advisor reaches e1 with one diagonal step.' },
    { id: 'general', title: 'General: one step', fen: position({}), solution: 'e0f0',
      rule: 'A general takes one horizontal or vertical step inside its palace.', task: 'Move Red’s general from e0 to f0.',
      hint: 'Stay on the back rank and move one point right.', success: 'The general stays in the palace. It cannot move diagonally.' },
    { id: 'soldier', title: 'Soldier: across the river', fen: position({ e5: 'P' }), solution: 'e5d5',
      rule: 'Soldiers advance one point. Across the river they can also step sideways, but never backward.', task: 'Move the soldier from e5 sideways to d5.',
      hint: 'This soldier has already crossed the river, so a sideways step is available.', success: 'Crossing the river adds sideways movement. Soldiers do not promote at the far edge.' },
    { id: 'generals', title: 'Keep the generals apart', fen: position({ e5: 'P' }, 'e9'), solution: 'e5e6',
      rule: 'The generals cannot face each other along an empty file.', task: 'Advance the soldier from e5 to e6 while keeping the e-file blocked.',
      hint: 'Moving this soldier sideways would expose your general.', success: 'The soldier still separates the generals. A sideways move here would be illegal.' },
    { id: 'stalemate', title: 'Stalemate wins', fen: position({ e7: 'R' }), solution: 'e7e8',
      rule: 'A player with no legal move loses, even when their general is not in check.', task: 'Move the chariot from e7 to e8 to leave Black without a legal move.',
      hint: 'From e8, the chariot covers both d8 and e9, the black general’s exits.', success: 'Black is not in check, but has no legal move. This is a win for Red in Xiangqi.' },
] as const;
export type RuleLesson = typeof RULE_LESSONS[number];

export function attemptRuleLesson(lesson: RuleLesson, move: string) {
    const board = parseFenBoard(lesson.fen);
    const checked = validateMoveStr(move, board, 'w');
    if (!checked.ok || !checked.mv) return { solved: false, board, message: formatMoveRuleHint(checked.reason) };
    if (move !== lesson.solution) return { solved: false, board, message: `That move is legal. For this exercise: ${lesson.task}` };
    const mv = checked.mv;
    board[mv.toRank][mv.toFile] = board[mv.fromRank][mv.fromFile]; board[mv.fromRank][mv.fromFile] = '';
    return { solved: true, board, message: lesson.success };
}

export function readRuleLessonProgress(storage: KeyValueStorage | null = getLocalStorage()): string[] {
    const raw = readStorage(RULE_LESSONS_STORAGE_KEY, storage);
    if (!raw || raw.length > 4096) return [];
    try {
        const value: unknown = JSON.parse(raw);
        return Array.isArray(value) ? RULE_LESSONS.filter(lesson => value.includes(lesson.id)).map(lesson => lesson.id) : [];
    } catch { return []; }
}

export function saveRuleLessonProgress(current: string[], storage: KeyValueStorage | null = getLocalStorage()) {
    const known = new Set([...readRuleLessonProgress(storage), ...current]);
    const completed = RULE_LESSONS.filter(lesson => known.has(lesson.id)).map(lesson => lesson.id);
    return { completed, saved: writeStorage(RULE_LESSONS_STORAGE_KEY, JSON.stringify(completed), storage) };
}

export function completeRuleLesson(id: string, current: string[], storage: KeyValueStorage | null = getLocalStorage()) {
    return saveRuleLessonProgress([...current, id], storage);
}
