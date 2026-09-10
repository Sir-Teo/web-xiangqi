import { describe, expect, it } from 'vitest';
import { buildShareUrl, moveTreeContainsLine } from './shareUrl';
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
