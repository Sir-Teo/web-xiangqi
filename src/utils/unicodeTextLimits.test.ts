import { describe, expect, it } from 'vitest';
import { normalizeMoveComment, summarizeMoveComment } from './moveComment';
import { normalizeGameMetadata } from './gameMetadata';
import { normalizeSavedGame } from './gameLibrary';
import { buildShareUrl } from './shareUrl';
import { extractUciMoveTree } from './moveImport';
import { exportPgnFromMoveTree } from './gameExport';
import { START_POSITION_FEN } from './xiangqi';

describe('Unicode at stored text limits', () => {
    it('omits a whole character when its UTF-16 pair crosses the note limit', () => {
        for (const character of ['🐎', '𠮷']) {
            expect(normalizeMoveComment('中'.repeat(499) + character)).toBe('中'.repeat(499));
            expect(normalizeMoveComment('中'.repeat(498) + character)).toBe('中'.repeat(498) + character);
        }
    });
    it('does not split an emoji in the move-list preview', () => {
        expect(summarizeMoveComment('中'.repeat(47) + '🐎 after')).toBe('中'.repeat(47) + '…');
    });
    it('bounds player names and library labels without leaving half a character', () => {
        expect(normalizeGameMetadata({ redPlayer: '中'.repeat(255) + '𠮷' })?.redPlayer).toBe('中'.repeat(255));
        const game = normalizeSavedGame({ id: 'test', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'],
            label: '中'.repeat(119) + '🐎', opening: '中'.repeat(159) + '𠮷' });
        expect(game?.label).toBe('中'.repeat(119));
        expect(game?.opening).toBe('中'.repeat(159));
    });
    it('keeps a bounded starting note unchanged when shared through URLSearchParams', () => {
        const note = normalizeMoveComment('x'.repeat(499) + '🐎');
        const { url } = buildShareUrl('https://example.org/', START_POSITION_FEN, [], 'PvP', undefined, note);
        expect(new URL(url).searchParams.get('note')).toBe(note);
        expect(url).not.toContain('%EF%BF%BD');
    });
    it('keeps a bounded move note intact across text-file encoding and PGN import', () => {
        const tree = [{ uci: 'h2e2', comment: normalizeMoveComment('中'.repeat(499) + '🐎') }];
        const textFile = new TextDecoder().decode(new TextEncoder().encode(exportPgnFromMoveTree(tree)!));
        expect(extractUciMoveTree(textFile).moveTree).toEqual(tree);
    });
});
