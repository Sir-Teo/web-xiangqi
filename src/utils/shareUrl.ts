/**
 * The share link: which of a position's four facts a URL has to carry, and
 * which it can leave out because the app would have assumed them anyway.
 *
 * Split out of `App.tsx` and given the current href as an argument rather than
 * reading `window.location`, which is what makes the rules testable without a
 * browser. They are rules worth testing: three of the four parameters are
 * conditional, and the fourth can be dropped mid-build when a variation tree
 * does not fit the encoder's budget -- a caller that ignores `treeOmitted`
 * hands someone a link quietly missing their variations.
 */
import { normalizeMoveComment } from './moveComment';
import { encodeSavedMoveTreeParam } from './shareTree';
import type { SavedMoveTreeNode } from './gameLibrary';
import { START_POSITION_FEN } from './xiangqi';
import type { GameMode } from '../App';

export type ShareUrlBuildResult = {
  url: string;
  /** A tree was asked for and would not fit. The link is still valid without it. */
  treeOmitted: boolean;
};

export function buildShareUrl(
  currentHref: string,
  rootFen: string,
  moves: string[],
  mode: GameMode,
  moveTree?: SavedMoveTreeNode[],
  rootComment?: string,
  mainLinePinned = false,
): ShareUrlBuildResult {
  const url = new URL(currentHref);
  url.search = '';
  url.hash = '';
  const note = normalizeMoveComment(rootComment);
  if (note) url.searchParams.set('note', note);
  if (rootFen !== START_POSITION_FEN) {
    url.searchParams.set('fen', rootFen);
  }
  if (moves.length > 0) {
    url.searchParams.set('moves', moves.join(' '));
  }
  let treeIncluded = false;
  if (moveTree?.length) {
    const encodedTree = encodeSavedMoveTreeParam(moveTree);
    if (encodedTree) {
      url.searchParams.set('tree', encodedTree);
      treeIncluded = true;
    }
  }
  if (mainLinePinned && treeIncluded) url.searchParams.set('main', '1');
  if (mode !== 'PvP') {
    url.searchParams.set('mode', mode);
  }
  return {
    url: url.toString(),
    treeOmitted: Boolean(moveTree?.length) && !treeIncluded,
  };
}

/**
 * Whether a tree already holds the line, walked move by move from the root.
 * A link carrying both has to agree with itself; one that does not is the
 * mismatched-tree case the loader falls back from.
 */
export function moveTreeContainsLine(moveTree: SavedMoveTreeNode[] | undefined, moves: string[]) {
  if (moves.length === 0) return true;
  let siblings = moveTree ?? [];
  for (const move of moves) {
    const child = siblings.find((node) => node.uci === move);
    if (!child) return false;
    siblings = child.children ?? [];
  }
  return true;
}
