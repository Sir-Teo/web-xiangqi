import type { SavedGame, SavedMoveTreeNode } from './gameLibrary';
import { START_POSITION_FEN } from './xiangqi';
import { normalizeMoveComment } from './moveComment';
import { normalizeGameMetadata } from './gameMetadata';

type Study = Pick<SavedGame, 'gameMode' | 'moves' | 'moveTree' | 'metadata' | 'startFen' | 'rootComment' | 'rootResult' | 'mainLinePinned' | 'review'>;

/** Content identity for the save indicator. Navigation and automatic engine readings aren't edits. */
export function studyContent(study: Study): string {
  return `${studyDetailsContent(study)}\n${studyMoveContent(study)}`;
}

/** Compare details separately so editing a player name can reuse the move content. */
export function studyDetailsContent(study: Omit<Study, 'moves' | 'moveTree'>): string {
  return JSON.stringify([study.gameMode, study.startFen || START_POSITION_FEN, normalizeMoveComment(study.rootComment),
    study.rootResult, study.mainLinePinned === true, normalizeGameMetadata(study.metadata), study.review]);
}

/** Both compact lines and full trees have the same identity for the same moves. */
export function studyMoveContent(study: Pick<Study, 'moves' | 'moveTree'>): string {
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
  return JSON.stringify(rows);
}

function contentRow(node: SavedMoveTreeNode, depth: number) {
  return [depth, node.uci, normalizeMoveComment(node.comment), node.nags?.length ? node.nags : undefined, node.recordedResult, node.analysis];
}
