import { describe, expect, it } from 'vitest';
import { pgnDownloadFilename } from './pgnFilename';
import { formatPgnDate } from './gameExport';

const JAN_2 = new Date(2026, 0, 2, 12, 0);

describe('the name a downloaded PGN gets', () => {
    it('dates the file the way the file dates itself', () => {
        expect(pgnDownloadFilename('game', JAN_2))
            .toContain(formatPgnDate(JAN_2).replace(/\./g, '-'));
    });

    it('uses the local date, so a file and the card that offered it agree', () => {
        // `toISOString()` is UTC. A game saved at 9:30pm in New York showed
        // "Aug 31" on its card and downloaded as `...2026-09-01-...`.
        const evening = new Date(2026, 7, 31, 21, 30);
        expect(pgnDownloadFilename('club night', evening)).toContain('2026-08-31');
        expect(evening.getDate()).toBe(31);
    });

    it('slugs a name down to something a filesystem will take', () => {
        expect(pgnDownloadFilename('Club Night #3!', JAN_2)).toBe('web-xiangqi-2026-01-02-club-night-3.pgn');
        expect(pgnDownloadFilename('  spaced  ', JAN_2)).toBe('web-xiangqi-2026-01-02-spaced.pgn');
        expect(pgnDownloadFilename('中炮對屏風馬', JAN_2)).toBe('web-xiangqi-2026-01-02-game.pgn');
    });

    it('never ends up with an empty slug', () => {
        // A name of nothing but punctuation slugs to empty, and
        // `web-xiangqi-2026-01-02-.pgn` is not a filename anyone wants.
        expect(pgnDownloadFilename('!!!', JAN_2)).toBe('web-xiangqi-2026-01-02-game.pgn');
        expect(pgnDownloadFilename('', JAN_2)).toBe('web-xiangqi-2026-01-02-game.pgn');
        expect(pgnDownloadFilename(undefined, JAN_2)).toBe('web-xiangqi-2026-01-02-game.pgn');
    });

    it('takes the caller\'s own fallback', () => {
        expect(pgnDownloadFilename(undefined, JAN_2, 'saved-game'))
            .toBe('web-xiangqi-2026-01-02-saved-game.pgn');
    });

    it('bounds a very long name', () => {
        const name = pgnDownloadFilename('a'.repeat(200), JAN_2);
        expect(name.length).toBeLessThan(90);
        expect(name.endsWith('.pgn')).toBe(true);
    });
});

/**
 * The slug is trimmed, then cut, so the cut can undo the trim.
 *
 * `replace(/^-+|-+$/g, '')` runs before `slice(0, 48)`. Any name whose 49th
 * character is a space or a piece of punctuation has that character turned
 * into a hyphen first, and the cut then lands immediately after it --
 * `web-xiangqi-2026-01-02-aaaa…aaa-.pgn`, which is the filename the comment
 * beside that line says nobody wants.
 *
 * Trimming again after the cut is the fix, and it has to stay before the
 * `|| fallback`: a name of nothing but punctuation still needs to become
 * `game` rather than an empty slug.
 */
describe('a long name cut at the limit', () => {
    const when = new Date(2026, 0, 2);

    it('does not end in the hyphen the cut created', () => {
        // 47 characters, then the space that becomes the 48th.
        const name = `${'a'.repeat(47)} tail`;
        const filename = pgnDownloadFilename(name, when);
        expect(filename).not.toMatch(/-\.pgn$/);
        expect(filename).toBe(`web-xiangqi-2026-01-02-${'a'.repeat(47)}.pgn`);
    });

    it('still fills the limit when the cut lands mid-word', () => {
        expect(pgnDownloadFilename(`${'b'.repeat(48)} tail`, when))
            .toBe(`web-xiangqi-2026-01-02-${'b'.repeat(48)}.pgn`);
        expect(pgnDownloadFilename(`${'c'.repeat(46)} xy`, when))
            .toBe(`web-xiangqi-2026-01-02-${'c'.repeat(46)}-x.pgn`);
    });

    it('still falls back when trimming leaves nothing', () => {
        expect(pgnDownloadFilename('....', when)).toBe('web-xiangqi-2026-01-02-game.pgn');
        expect(pgnDownloadFilename('中炮对屏风马', when)).toBe('web-xiangqi-2026-01-02-game.pgn');
    });
});
