import { describe, expect, it } from 'vitest';
import { buildShareUrl, moveTreeContainsLine, readShareParams, MAX_SHARE_URL_LENGTH } from './shareUrl';
import { START_POSITION_FEN } from './xiangqi';
import type { SavedMoveTreeNode } from './gameLibrary';

const HERE = 'https://example.test/web-xiangqi/?moves=old&tree=old#somewhere';
const params = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

/**
 * A share link carries only what the app would not have assumed anyway, which
 * is why three of its four parameters are conditional. Each case below is one
 * of those conditions, plus the one thing a caller must not ignore: a tree that
 * did not fit.
 */
describe('buildShareUrl', () => {
  it('carries nothing at all from the opening position', () => {
    const { url, treeOmitted } = buildShareUrl(HERE, START_POSITION_FEN, [], 'PvP');
    expect(url).toBe('https://example.test/web-xiangqi/');
    expect(treeOmitted).toBe(false);
  });

  it('drops the query and fragment it was called from', () => {
    const { url } = buildShareUrl(HERE, START_POSITION_FEN, ['h2e2'], 'PvP');
    expect(url).not.toContain('old');
    expect(url).not.toContain('#');
    expect(params(url)).toEqual({ moves: 'h2e2' });
  });

  it('writes the moves as one space-separated value', () => {
    const { url } = buildShareUrl(HERE, START_POSITION_FEN, ['h2e2', 'h9g7', 'h0g2'], 'PvP');
    expect(params(url).moves).toBe('h2e2 h9g7 h0g2');
  });

  it('carries a custom root but never the opening one', () => {
    const custom = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
    expect(params(buildShareUrl(HERE, custom, [], 'PvP').url).fen).toBe(custom);
    expect(params(buildShareUrl(HERE, START_POSITION_FEN, [], 'PvP').url).fen).toBeUndefined();
  });

  it.each([
    ['PvAI-Black' as const],
    ['PvAI-Red' as const],
    ['AIvAI' as const],
  ])('carries the %s mode, which is not the default', (mode) => {
    expect(params(buildShareUrl(HERE, START_POSITION_FEN, [], mode).url).mode).toBe(mode);
  });

  it('leaves the local-board mode out, because that is what a link without one opens', () => {
    expect(params(buildShareUrl(HERE, START_POSITION_FEN, [], 'PvP').url).mode).toBeUndefined();
  });

  it('carries a variation tree and says it did', () => {
    const tree: SavedMoveTreeNode[] = [{ uci: 'h2e2', children: [{ uci: 'h9g7', children: [] }] }];
    const { url, treeOmitted } = buildShareUrl(HERE, START_POSITION_FEN, ['h2e2'], 'PvP', tree);
    expect(params(url).tree).toBeTruthy();
    expect(treeOmitted).toBe(false);
  });

  it('reports a tree that would not fit rather than a link that quietly lost it', () => {
    // The encoder's budget is on the JSON's length and nothing else -- it does
    // not look at the moves -- so size is the only thing separating these two.
    // The small one is here so the large one cannot pass for some other reason.
    const branches = (count: number): SavedMoveTreeNode[] => Array.from({ length: count }, (_, index) => ({
      uci: `h2e${index % 10}`,
      children: Array.from({ length: 20 }, (__, child) => ({ uci: `b${child % 10}c2`, children: [] })),
    }));

    const carried = buildShareUrl(HERE, START_POSITION_FEN, ['h2e2'], 'PvP', branches(2));
    expect(carried.treeOmitted).toBe(false);
    expect(params(carried.url).tree).toBeTruthy();

    const { url, treeOmitted } = buildShareUrl(HERE, START_POSITION_FEN, ['h2e2'], 'PvP', branches(400));
    expect(treeOmitted).toBe(true);
    expect(params(url).tree).toBeUndefined();
    // The link is still a working link; only the variations are gone.
    expect(params(url).moves).toBe('h2e2');
  });

  it('says nothing was omitted when nothing was asked for', () => {
    expect(buildShareUrl(HERE, START_POSITION_FEN, ['h2e2'], 'PvP', []).treeOmitted).toBe(false);
    expect(buildShareUrl(HERE, START_POSITION_FEN, ['h2e2'], 'PvP').treeOmitted).toBe(false);
  });
});

describe('moveTreeContainsLine', () => {
  const tree: SavedMoveTreeNode[] = [
    { uci: 'h2e2', children: [
      { uci: 'h9g7', children: [{ uci: 'h0g2', children: [] }] },
      { uci: 'b9c7', children: [] },
    ] },
    { uci: 'b2e2', children: [] },
  ];

  it('holds the empty line, whatever the tree', () => {
    expect(moveTreeContainsLine(tree, [])).toBe(true);
    expect(moveTreeContainsLine(undefined, [])).toBe(true);
    expect(moveTreeContainsLine([], [])).toBe(true);
  });

  it('walks a line that is there, to any depth', () => {
    expect(moveTreeContainsLine(tree, ['h2e2'])).toBe(true);
    expect(moveTreeContainsLine(tree, ['h2e2', 'b9c7'])).toBe(true);
    expect(moveTreeContainsLine(tree, ['h2e2', 'h9g7', 'h0g2'])).toBe(true);
  });

  it('refuses a line that leaves the tree at any point', () => {
    expect(moveTreeContainsLine(tree, ['a0a1'])).toBe(false);
    expect(moveTreeContainsLine(tree, ['h2e2', 'a0a1'])).toBe(false);
    expect(moveTreeContainsLine(tree, ['h2e2', 'h9g7', 'h0g2', 'i9h9'])).toBe(false);
    expect(moveTreeContainsLine(undefined, ['h2e2'])).toBe(false);
  });

  it('reads a sibling as a sibling, not as a continuation', () => {
    expect(moveTreeContainsLine(tree, ['b2e2'])).toBe(true);
    expect(moveTreeContainsLine(tree, ['h2e2', 'b2e2'])).toBe(false);
  });
});

/**
 * A note goes into the link as a query parameter, and readers write notes with
 * the characters that break query parameters.
 *
 * `&` starts another parameter and `#` starts the fragment, so a note built by
 * string concatenation is truncated at the first `#` and split at the first
 * `&` -- the recipient opens the link and the note is half there, or gone. `%`
 * is worse than either: it makes the whole parameter undecodable.
 *
 * `url.searchParams.set` handles all of it, and nothing checked that it is
 * what is being used. Replacing that one line with `url.search += ...` passed
 * the entire suite.
 */
describe('a note survives the trip through the link', () => {
    const noteIn = (note: string) => {
        const { url } = buildShareUrl(HERE, START_POSITION_FEN, ['h2e2'], 'PvP', undefined, note);
        return new URL(url).searchParams.get('note');
    };

    it('carries the characters that would otherwise cut the link short', () => {
        expect(noteIn('a & b = c')).toBe('a & b = c');
        expect(noteIn('hash # and plus + and percent %')).toBe('hash # and plus + and percent %');
        expect(noteIn('quote " and apostrophe \'')).toBe('quote " and apostrophe \'');
    });

    it('carries the scripts this app is written for', () => {
        expect(noteIn('炮二平五 is the central cannon')).toBe('炮二平五 is the central cannon');
        expect(noteIn('emoji 🐴 horse')).toBe('emoji 🐴 horse');
    });

    it('normalises the note on the way in, as a stored one is normalised', () => {
        // One line and no padding: the same shape `normalizeMoveComment` gives
        // a note saved with the game, so a note does not change by being shared.
        expect(noteIn('line one\nline two')).toBe('line one line two');
        expect(noteIn('  padded  ')).toBe('padded');
    });
});


describe('large share links', () => {
  it('keeps the complete study out of the HTTP request and reads it back', () => {
    const moves = Array.from({ length: 240 }, (_, i) => ['b0c2', 'b9c7', 'c2b0', 'c7b9'][i % 4]);
    let tree: SavedMoveTreeNode[] = [];
    for (const uci of [...moves].reverse()) tree = [{ uci, ...(tree.length ? { children: tree } : {}) }];
    let node = tree[0];
    while (7990 - JSON.stringify(tree).length > 13) {
      node.comment = 'x'.repeat(Math.min(500, 7990 - JSON.stringify(tree).length - 13));
      node = node.children![0];
    }
    const result = buildShareUrl(HERE, START_POSITION_FEN, moves, 'PvP', tree, '棋'.repeat(500), true);
    const url = new URL(result.url);
    expect(result.treeOmitted).toBe(false);
    expect(url.search).toBe('');
    expect(url.hash).toMatch(/^#share=1&/);
    expect(result.url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
    const received = readShareParams(url);
    expect(received.get('moves')).toBe(moves.join(' '));
    expect(received.get('note')).toBe('棋'.repeat(500));
    expect(received.get('main')).toBe('1');
    expect(received.get('tree')).toBeTruthy();
    // URL fragments are excluded from an HTTP request target.
    expect(url.pathname + url.search).toBe('/web-xiangqi/');
  });

  it('retains legacy query links and gives an explicit share fragment precedence', () => {
    expect(readShareParams(new URL('https://example.test/?moves=h2e2#other')).get('moves')).toBe('h2e2');
    expect(readShareParams(new URL('https://example.test/?moves=h2e2#share=1&moves=b0c2')).get('moves')).toBe('b0c2');
  });

  it('refuses an oversized complete URL rather than copying an unusable link', () => {
    expect(() => buildShareUrl('https://example.test/' + 'x'.repeat(MAX_SHARE_URL_LENGTH), START_POSITION_FEN, [], 'PvP')).toThrow(/Export PGN/);
  });
});
