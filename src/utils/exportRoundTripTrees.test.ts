import { describe, expect, it } from 'vitest';
import { exportPgnFromMoveTree } from './gameExport';
import { extractUciMoveTree } from './moveImport';
import { parsePgnCollection } from './pgnCollection';
import type { SavedMoveTreeNode } from './gameLibrary';
import {
    START_FEN,
    cloneBoardState,
    legalMovesFrom,
    otherSide,
    parseFenBoard,
    pieceSide,
    squareToUci,
    validateMoveStr,
    type BoardState,
    type Side,
} from './xiangqi';

/**
 * A branching study out to PGN and back in, over generated trees.
 *
 * `exportRoundTripLong` sends one real 120-ply game through
 * `exportPgnFromUci`, which has no variations to write. The tree exporter is a
 * different function -- it numbers moves from the ply rather than counting
 * along the line, and it has to open and close parentheses -- and nothing
 * walked it over a shape it had not been handed by hand.
 *
 * Generated rather than listed, because the interesting shapes are the ones
 * nobody thinks to write: a variation on the first ply, a variation whose
 * parent is itself a variation, two variations on the same move, a branch that
 * ends immediately.
 */
function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function legalUcis(board: BoardState, side: Side): string[] {
    const out: string[] = [];
    for (let rank = 0; rank < 10; rank += 1) {
        for (let file = 0; file < 9; file += 1) {
            const piece = board[rank][file];
            if (!piece || pieceSide(piece) !== side) continue;
            for (const to of legalMovesFrom(board, file, rank, side)) {
                out.push(`${squareToUci(file, rank)}${squareToUci(to.file, to.rank)}`);
            }
        }
    }
    return out;
}

function played(board: BoardState, uci: string, side: Side): BoardState | null {
    const checked = validateMoveStr(uci, board, side);
    if (!checked.ok || !checked.mv) return null;
    const next = cloneBoardState(board);
    const { fromFile, fromRank, toFile, toRank } = checked.mv;
    next[toRank][toFile] = next[fromRank][fromFile];
    next[fromRank][fromFile] = '';
    return next;
}

/** A random legal tree: every node's move is legal in the position above it. */
function growTree(random: () => number, budget: { nodes: number }) {
    const build = (board: BoardState, side: Side, depth: number): SavedMoveTreeNode[] => {
        if (depth === 0 || budget.nodes <= 0) return [];
        const legal = legalUcis(board, side);
        if (!legal.length) return [];
        // One child usually, sometimes two, occasionally three. Three matters:
        // with only ever two, no node carries *two* variations, and an
        // exporter that wrote just the first of them round-tripped cleanly.
        const spread = random();
        const wanted = spread < 0.15 ? 3 : spread < 0.4 ? 2 : 1;
        const chosen = new Set<string>();
        const nodes: SavedMoveTreeNode[] = [];
        for (let i = 0; i < wanted && budget.nodes > 0; i += 1) {
            const uci = legal[Math.floor(random() * legal.length)];
            if (chosen.has(uci)) continue;
            chosen.add(uci);
            const next = played(board, uci, side);
            if (!next) continue;
            budget.nodes -= 1;
            nodes.push({ uci, children: build(next, otherSide(side), depth - 1) });
        }
        return nodes;
    };
    return build(parseFenBoard(START_FEN), 'w', 7);
}

/** Every root-to-leaf line, as space-joined move strings. */
function lines(nodes: SavedMoveTreeNode[], prefix: string[] = []): string[] {
    return nodes.flatMap((node) => {
        const path = [...prefix, node.uci];
        return node.children?.length ? lines(node.children, path) : [path.join(' ')];
    });
}

function primaryLine(nodes: SavedMoveTreeNode[]): string[] {
    const out: string[] = [];
    let current: SavedMoveTreeNode | undefined = nodes[0];
    while (current) {
        out.push(current.uci);
        current = current.children?.[0];
    }
    return out;
}

describe('a branching study survives export and import', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('keeps every line, seed %i', (seed) => {
        const tree = growTree(mulberry32(seed), { nodes: 24 });
        expect(tree.length).toBeGreaterThan(0);

        const pgn = exportPgnFromMoveTree(tree, { mainLineMoves: primaryLine(tree) });
        expect(pgn, 'the exporter refused a tree it built from legal moves').not.toBeNull();

        const read = extractUciMoveTree(pgn!);
        expect(read.tooLarge).toBe(false);
        expect(read.hadMoreGames).toBe(false);
        expect([...lines(read.moveTree)].sort()).toEqual([...lines(tree)].sort());
        // Which line is the main one, not only which lines exist: a set
        // comparison alone cannot tell a main line from a variation, and the
        // exporter chooses between them from the saved cursor.
        expect(read.moves).toEqual(primaryLine(tree));
    });

    it('keeps a main line that is not the first branch', () => {
        // The saved cursor can sit on a variation, and then the exporter must
        // write *that* line as the main text and the first child inside
        // parentheses. With the cursor always on the first child -- which is
        // what the generated cases above use -- the choice is invisible.
        const board = parseFenBoard(START_FEN);
        const [first, second] = legalUcis(board, 'w');
        const reply = legalUcis(played(board, second, 'w')!, 'b')[0];
        const tree: SavedMoveTreeNode[] = [
            { uci: first, children: [] },
            { uci: second, children: [{ uci: reply, children: [] }] },
        ];

        const pgn = exportPgnFromMoveTree(tree, { mainLineMoves: [second, reply] });
        expect(pgn).not.toBeNull();
        const read = extractUciMoveTree(pgn!);
        expect(read.moves).toEqual([second, reply]);
        expect([...lines(read.moveTree)].sort()).toEqual([...lines(tree)].sort());
    });

    it('carries a variation on the very first ply', () => {
        // The shape the generator reaches least often and the numbering is
        // most likely to get wrong: two alternatives before any move is played.
        const board = parseFenBoard(START_FEN);
        const [first, second] = legalUcis(board, 'w');
        const tree: SavedMoveTreeNode[] = [{ uci: first, children: [] }, { uci: second, children: [] }];
        const pgn = exportPgnFromMoveTree(tree, { mainLineMoves: [first] });
        expect(pgn).not.toBeNull();
        expect([...lines(extractUciMoveTree(pgn!).moveTree)].sort()).toEqual([first, second].sort());
    });
});

/**
 * The same trees, read back by the *strict* reader.
 *
 * `extractUciMoveTree` is the lenient paste box: it skips what it cannot use.
 * `parsePgnCollection` is Library -> Import PGN collection, and its rule is the
 * opposite -- "unknown movetext is rejected, never skipped" -- so it throws
 * rather than drop a move. That makes one property worth holding above all
 * others here: **everything this app exports, it must be able to import
 * again.** If the exporter ever emits a shape the strict reader refuses, a
 * reader's own collection export stops being loadable, and the lenient
 * round-trip above would not notice.
 *
 * Covered by hand for a couple of trees already; these are the generated ones.
 */
describe('a branching study survives export and strict re-import', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('is accepted whole, seed %i', (seed) => {
        const tree = growTree(mulberry32(seed), { nodes: 24 });
        const pgn = exportPgnFromMoveTree(tree, { mainLineMoves: primaryLine(tree) })!;

        const games = parsePgnCollection(pgn);
        expect(games).toHaveLength(1);
        expect([...lines(games[0].moveTree ?? [])].sort()).toEqual([...lines(tree)].sort());
        expect(games[0].moves).toEqual(primaryLine(tree));
    });

    it('refuses a movetext it cannot read, rather than dropping it', () => {
        // The control for the suite above: these assertions mean something
        // only because this reader does throw on movetext it does not
        // understand, so "it parsed" is a real statement about the export.
        expect(() => parsePgnCollection('h2e2 sideways h9g7 *')).toThrow();
    });
});
