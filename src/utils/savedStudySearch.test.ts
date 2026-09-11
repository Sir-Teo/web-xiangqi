import { describe, expect, it } from 'vitest';
import { evaluationSearchText, savedTreeSearchText } from './savedStudySearch';
import { matchesSearchTerms, toSearchTerms } from './searchTerms';
import type { SavedMoveTreeNode } from './gameLibrary';

describe('searching saved study annotations', () => {
    it('indexes notes and qualities throughout variations alongside their moves', () => {
        const tree: SavedMoveTreeNode[] = [{ uci: 'h2e2', comment: 'Main road', children: [
            { uci: 'h9g7' }, { uci: 'b9c7', comment: 'Dragon trap 龙门', quality: 'blunder', evalScore: 20000, evalScoreKind: 'cp' },
        ] }];
        const before = JSON.stringify(tree);
        const text = savedTreeSearchText(tree);
        for (const query of ['Main road', 'dragon', '龙门', 'h9g7', 'b9c7 BLUNDER', '+200.00', '20000cp']) {
            expect(matchesSearchTerms(text, toSearchTerms(query)), query).toBe(true);
        }
        expect(matchesSearchTerms(text, toSearchTerms('mate'))).toBe(false);
        expect(JSON.stringify(tree)).toBe(before);
    });
    it('includes the last note at the supported maximum study depth', () => {
        const tree: SavedMoveTreeNode[] = [];
        let children = tree;
        for (let i = 0; i < 1024; i++) {
            const node: SavedMoveTreeNode = { uci: 'h2e2', children: [] };
            if (i === 1023) node.comment = 'Deep preparation';
            children.push(node); children = node.children!;
        }
        expect(savedTreeSearchText(tree)).toContain('Deep preparation');
    });
    it('handles studies without a saved tree', () => {
        expect(savedTreeSearchText(undefined)).toBe('');
        expect(savedTreeSearchText([])).toBe('');
    });
});

describe('searchable evaluation text', () => {
    it.each([[29997, '+M3'], [-29996, '-M4'], [30000, '+M0'], [-30000, '-M0']])('keeps mate %s distinct from centipawns', (score, display) => {
        const text = evaluationSearchText(score as number);
        expect(text).toContain(display as string);
        expect(text).not.toContain('cp');
    });
    it.each([0, -75, 20000, 40000])('supports human and centipawn forms for a cp score of %s', score => {
        const text = evaluationSearchText(score, 'cp');
        expect(text).toContain(`${score}cp`);
        expect(text).toContain((score / 100).toFixed(2));
        expect(text).not.toContain('M');
    });
    it.each([undefined, NaN, Infinity, -Infinity])('does not invent a searchable score for %s', score => {
        expect(evaluationSearchText(score)).toBe('');
    });
});
