import { describe, expect, it } from 'vitest';
import { evaluationSearchText, savedTreeSearchText, savedStudySearchEntries, savedStudyMatchMoves } from './savedStudySearch';
import { matchesSearchTerms, toSearchTerms } from './searchTerms';
import type { SavedMoveTreeNode } from './gameLibrary';
import type { StudyAnalysis } from './studyAnalysis';

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
    it('indexes saved analysis on side lines without assigning a move evaluation', () => {
        const analysis: StudyAnalysis = { version: 1, position: 'position startpos moves h2e2', move: 'a9a8', score: 20000, scoreKind: 'cp',
            bounded: true, bound: 'upper', depth: 27, savedAt: 1,
            engine: { name: 'Pikafish Research build', variant: 'single-simd', threads: 1, hashMB: 64 },
            multiPv: 2, candidates: ['a9a8', 'i9i8'], effort: { nodes: 123456, timeMs: 1200, seldepth: 35 } };
        const tree: SavedMoveTreeNode[] = [{ uci: 'h2e2', children: [{ uci: 'h9g7' }, { uci: 'a9a8', analysis }] }];
        const before = JSON.stringify(tree);
        const text = savedTreeSearchText(tree);
        for (const query of ['saved analysis', 'Pikafish Research', 'D27', 'depth 27', '+200.00 upper bound', '20000cp',
            'upperbound', 'single-simd 1 thread', '64 MB hash', '64MB', 'MultiPV 2 selected candidates i9i8',
            '123456 nodes', `${(123456).toLocaleString()} nodes`, '1200ms', `${(1200).toLocaleString()} ms`, 'selective depth 35']) {
            expect(matchesSearchTerms(text, toSearchTerms(query)), query).toBe(true);
        }
        expect(text).not.toContain('mate');
        expect(JSON.stringify(tree)).toBe(before);
        expect(tree[0].children![1]).not.toHaveProperty('evalScore');
    });
    it('keeps saved mate readings distinct from centipawns and omits absent effort', () => {
        const analysis: StudyAnalysis = { version: 1, position: 'position startpos', move: 'h2e2', score: 29997, scoreKind: 'mate',
            bounded: false, depth: 18, savedAt: 1, engine: { name: 'Pikafish', variant: 'threaded-simd', threads: 8, hashMB: 256 }, multiPv: 1 };
        const text = savedTreeSearchText([{ uci: 'h2e2', analysis }]);
        for (const query of ['+M3', 'exact search score', 'all legal moves', 'Not recorded']) {
            expect(matchesSearchTerms(text, toSearchTerms(query)), query).toBe(true);
        }
        expect(text).not.toContain('29997cp');
        expect(text).not.toContain('0 nodes');
    });
    it('handles studies without a saved tree', () => {
        expect(savedTreeSearchText(undefined)).toBe('');
        expect(savedTreeSearchText([])).toBe('');
    });
    it('locates repeated moves on distinct branches in main-line order without mutating the study', () => {
        const tree = [{ uci: 'h2e2', children: [{ uci: 'h9g7', comment: 'Shared preparation' }] },
            { uci: 'b2e2', children: [{ uci: 'h9g7', comment: 'Shared preparation 龙门', nags: [2] }] }];
        const before = JSON.stringify(tree);
        const entries = savedStudySearchEntries(tree);
        const matches = entries.filter(entry => matchesSearchTerms(entry.text, toSearchTerms('Shared preparation')));
        expect(matches.map(savedStudyMatchMoves)).toEqual([['h2e2', 'h9g7'], ['b2e2', 'h9g7']]);
        expect(matches.map(entry => entry.ply)).toEqual([2, 2]);
        expect(matchesSearchTerms(matches[1].text, toSearchTerms('龙门 $2'))).toBe(true);
        expect(JSON.stringify(tree)).toBe(before);
        expect(savedStudySearchEntries(undefined)).toEqual([]);
    });
    it('keeps a maximum-depth move index linked rather than copying every ancestor path', () => {
        const tree: SavedMoveTreeNode[] = [];
        let children = tree;
        for (let i = 0; i < 1024; i++) {
            const node: SavedMoveTreeNode = { uci: 'h2e2', children: [] };
            children.push(node); children = node.children!;
        }
        const entries = savedStudySearchEntries(tree);
        expect(entries).toHaveLength(1024);
        expect(entries.at(-1)?.parent).toBe(entries.at(-2));
        expect(entries.at(-1)?.ply).toBe(1024);
        expect(savedStudyMatchMoves(entries.at(-1)!)).toEqual(Array(1024).fill('h2e2'));
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
