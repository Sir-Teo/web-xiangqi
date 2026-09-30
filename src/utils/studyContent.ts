import type { SavedGame, SavedMoveTreeNode } from './gameLibrary';
import { START_POSITION_FEN } from './xiangqi';
import { normalizeMoveComment } from './moveComment';

type Study = Pick<SavedGame, 'gameMode' | 'moves' | 'moveTree' | 'metadata' | 'startFen' | 'rootComment' | 'rootResult' | 'mainLinePinned' | 'review'>;

/** Content identity for the save indicator. Navigation and automatic engine readings aren't edits. */
export function studyContent(study: Study): string {
  const rows: unknown[] = [];
  if (study.moveTree?.length) {
    const stack = study.moveTree.slice().reverse().map(node => ({ node, depth: 0 }));
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      rows.push(contentRow(node, depth));
      for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) stack.push({ node: node.children![i], depth: depth + 1 });
    }
  } else {
    study.moves.forEach((uci, depth) => rows.push(contentRow({ uci }, depth)));
  }
  return JSON.stringify([study.gameMode, study.startFen || START_POSITION_FEN, normalizeMoveComment(study.rootComment),
    study.rootResult, study.mainLinePinned === true, study.metadata, rows, study.review]);
}

function contentRow(node: SavedMoveTreeNode, depth: number) {
  return [depth, node.uci, normalizeMoveComment(node.comment), node.nags?.length ? node.nags : undefined, node.recordedResult, node.analysis];
}
