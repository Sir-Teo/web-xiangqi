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
