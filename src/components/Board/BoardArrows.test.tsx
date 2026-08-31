import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardArrows } from './BoardArrows';

/**
 * An arrow has to land on the squares it names, from either side of the board.
 *
 * This is pure geometry with one branch in it -- the orientation flip -- and it
 * was the largest file under `Board/` with no test. The failure it guards is
 * not subtle to a player and is invisible to every other check: a flipped board
 * whose arrows are not flipped points confidently at the wrong squares, and
 * the engine gets the blame.
 *
 * The expected numbers are worked out from the board rather than copied from
 * the implementation, so the test disagrees with the code if the code changes
 * its mind:
 *
 *   viewBox is 800 wide and 900 tall, nine files and ten ranks.
 *   x = file/8 * 800, and Black's view mirrors it: (8 - file)/8 * 800.
 *   y = (9 - rank)/9 * 900 with Red at the bottom, rank/9 * 900 with Black.
 *
 * So a1 is the far left, one rank up from Red's back rank: x 0, y 800 seen
 * from Red, and x 800, y 100 seen from Black.
 */

const arrow = (kind: 'engine' | 'last' = 'engine') => ([{
    from: { file: 0, rank: 1 },   // a1
    to: { file: 0, rank: 9 },     // a9, straight up the a file
    color: '#10b981',
    kind,
}]);

const render = (orientation: 'red' | 'black') =>
    renderToStaticMarkup(<BoardArrows arrows={arrow()} orientation={orientation} />);

/** The circle the component draws at the arrow's tail. */
function tail(html: string) {
    const match = html.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/** The first point of the arrowhead polygon, which is the destination square. */
function head(html: string) {
    const match = html.match(/<polygon points="([-\d.]+),([-\d.]+)/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

describe('an arrow drawn on the board', () => {
    it('runs from a1 to a9 as Red sees them', () => {
        const html = render('red');
        expect(tail(html)).toEqual({ x: 0, y: 800 });
        expect(head(html)).toEqual({ x: 0, y: 0 });
    });

    it('runs from the same two squares as Black sees them', () => {
        // Mirrored left to right and top to bottom, because Black's view is the
        // board turned around -- not a different pair of squares.
        const html = render('black');
        expect(tail(html)).toEqual({ x: 800, y: 100 });
        expect(head(html)).toEqual({ x: 800, y: 900 });
    });

    it('points the other way round when the board is flipped', () => {
        // The blunt version of the two above: whatever the numbers are, the two
        // orientations cannot agree, or one of them is not flipping.
        expect(tail(render('red'))).not.toEqual(tail(render('black')));
        expect(head(render('red'))).not.toEqual(head(render('black')));
    });

    it('records the squares it was asked for, whichever way the board faces', () => {
        for (const orientation of ['red', 'black'] as const) {
            expect(render(orientation)).toContain('data-from="0:1"');
            expect(render(orientation)).toContain('data-to="0:9"');
        }
    });

    it('draws nothing at all when there are no arrows', () => {
        expect(renderToStaticMarkup(<BoardArrows arrows={[]} orientation="red" />)).toBe('');
    });

    it('skips an arrow that goes nowhere rather than dividing by its length', () => {
        // from === to makes the direction vector zero, and normalising it would
        // put NaN into every coordinate of the path.
        const html = renderToStaticMarkup(
            <BoardArrows
                arrows={[{ from: { file: 4, rank: 3 }, to: { file: 4, rank: 3 }, color: '#fff' }]}
                orientation="red"
            />
        );
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('<circle');
    });
});
