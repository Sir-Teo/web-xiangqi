import { describe, expect, it } from 'vitest';
import { RULE_LESSONS, attemptRuleLesson, completeRuleLesson, readRuleLessonProgress } from './ruleLessons';
import { describeSetupProblem } from './positionSetup';
import { hasAnyLegalMove, isInCheck, parseFenBoard, validateMoveStr } from './xiangqi';
import { RULE_LESSONS_STORAGE_KEY } from './storageKeys';
import type { KeyValueStorage } from './storage';

function memoryStorage(initial: string | null = null): KeyValueStorage {
    const values = new Map(initial === null ? [] : [[RULE_LESSONS_STORAGE_KEY, initial]]);
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}

describe('guided rule lessons', () => {
    it.each(RULE_LESSONS)('$id starts in a valid position and accepts its legal solution', lesson => {
        const board = parseFenBoard(lesson.fen);
        expect(describeSetupProblem(board, 'w')).toBeNull();
        expect(validateMoveStr(lesson.solution, board, 'w').ok).toBe(true);
        const attempt = attemptRuleLesson(lesson, lesson.solution);
        expect(attempt.solved).toBe(true);
        expect(attempt.message).toBe(lesson.success);
        expect(attempt.board).not.toEqual(board);
        expect(parseFenBoard(lesson.fen)).toEqual(board);
    });
    it.each([
        ['horse', 'e4f6'], ['elephant', 'c4e6'], ['advisor', 'd0c1'],
        ['general', 'e0f1'], ['soldier', 'e5e4'], ['generals', 'e5d5'],
    ])('%s explains an illegal attempt without advancing the board', (id, move) => {
        const lesson = RULE_LESSONS.find(item => item.id === id)!;
        const attempt = attemptRuleLesson(lesson, move);
        expect(validateMoveStr(move, parseFenBoard(lesson.fen), 'w').ok).toBe(false);
        expect(attempt.solved).toBe(false);
        expect(attempt.message.length).toBeGreaterThan(10);
        expect(attempt.board).toEqual(parseFenBoard(lesson.fen));
    });
    it('keeps a legal alternative available to retry without claiming it is illegal', () => {
        const lesson = RULE_LESSONS[0];
        const attempt = attemptRuleLesson(lesson, 'a4a5');
        expect(attempt.solved).toBe(false);
        expect(attempt.message).toMatch(/That move is legal/);
        expect(attempt.board).toEqual(parseFenBoard(lesson.fen));
    });
    it('requires the cannon screen', () => {
        const lesson = RULE_LESSONS[2];
        const board = parseFenBoard(lesson.fen);
        board[6][4] = '';
        expect(validateMoveStr(lesson.solution, board, 'w').ok).toBe(false);
    });
    it('really ends in stalemate, without check', () => {
        const lesson = RULE_LESSONS[8];
        expect(hasAnyLegalMove(parseFenBoard(lesson.fen), 'b')).toBe(true);
        const { board } = attemptRuleLesson(lesson, lesson.solution);
        expect(isInCheck(board, 'b')).toBe(false);
        expect(hasAnyLegalMove(board, 'b')).toBe(false);
    });
});

describe('lesson progress', () => {
    it('merges other-tab progress, filters unknown IDs, and deduplicates completions', () => {
        const storage = memoryStorage('["horse","horse","unknown"]');
        expect(readRuleLessonProgress(storage)).toEqual(['horse']);
        expect(completeRuleLesson('chariot', ['cannon', 'unknown'], storage)).toEqual({ completed: ['chariot', 'horse', 'cannon'], saved: true });
        expect(completeRuleLesson('chariot', [], storage).completed).toEqual(['chariot', 'horse', 'cannon']);
        expect(readRuleLessonProgress(storage)).toEqual(['chariot', 'horse', 'cannon']);
    });
    it.each([null, '{broken', '{}', '[false,1,null]', ' '.repeat(4097)])('ignores malformed or excessive progress: %s', value => {
        expect(readRuleLessonProgress(memoryStorage(value))).toEqual([]);
    });
    it('retains in-session completions when storage fails', () => {
        const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
        expect(readRuleLessonProgress(storage)).toEqual([]);
        expect(completeRuleLesson('horse', ['chariot'], storage)).toEqual({ completed: ['chariot', 'horse'], saved: false });
        expect(completeRuleLesson('horse', [], null)).toEqual({ completed: ['horse'], saved: false });
    });
});
