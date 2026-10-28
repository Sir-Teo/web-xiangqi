import type { SavedGame, SavedMoveTreeNode } from './gameLibrary';
import { START_POSITION_FEN } from './xiangqi';
import { normalizeMoveComment } from './moveComment';
import { normalizeGameMetadata } from './gameMetadata';
import { recordedResultFromSavedResult, type RecordedResult } from './recordedResult';

type Study = Pick<SavedGame, 'gameMode' | 'moves' | 'moveTree' | 'metadata' | 'startFen' | 'rootComment' | 'rootResult' | 'mainLinePinned' | 'review' | 'result'>;

/** Content identity for the save indicator. Navigation and automatic engine readings aren't edits. */
export function studyContent(study: Study): string {
  const parts = studyContentParts(study);
  return `${parts.details}\n${parts.moves}`;
}

/** Account for legacy declarations restored by the loader without rewriting the source. */
export function studyContentParts(study: Study): { moves: string; details: string } {
  const rootResult = study.rootResult ?? (study.moves.length === 0 ? recordedResultFromSavedResult(study.result) : undefined);
  return { moves: studyMoveContent(study), details: studyDetailsContent({ ...study, rootResult }) };
}

/** Compare details separately so editing a player name can reuse the move content. */
export function studyDetailsContent(study: Omit<Study, 'moves' | 'moveTree'>): string {
  // Key moments use fresh runtime node IDs after loading; their move indices
  // carry the saved meaning. Reassigning an ID is navigation, not an edit.
  const review = study.review && { ...study.review, summary: { ...study.review.summary,
    keyMoments: study.review.summary.keyMoments.map(moment => ({ ...moment, nodeId: undefined })),
  } };
  return JSON.stringify([study.gameMode, study.startFen || START_POSITION_FEN, normalizeMoveComment(study.rootComment),
    study.rootResult, study.mainLinePinned === true, normalizeGameMetadata(study.metadata), review]);
}

/** Both compact lines and full trees have the same identity for the same moves. */
export function studyMoveContent(study: Pick<Study, 'moves' | 'moveTree' | 'result'>): string {
  const rows: unknown[] = [];
  const legacyResult = recordedResultFromSavedResult(study.result);
  if (study.moveTree?.length) {
    const endpoint = legacyResult ? savedEndpoint(study.moveTree, study.moves) : undefined;
    const stack = study.moveTree.slice().reverse().map(node => ({ node, depth: 0 }));
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      rows.push(contentRow(node, depth, node === endpoint ? legacyResult : undefined));
      for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) stack.push({ node: node.children![i], depth: depth + 1 });
    }
  } else {
    study.moves.forEach((uci, depth) => rows.push(contentRow({ uci }, depth, depth === study.moves.length - 1 ? legacyResult : undefined)));
  }
  return JSON.stringify(rows);
}

function savedEndpoint(nodes: SavedMoveTreeNode[], moves: string[]): SavedMoveTreeNode | undefined {
  let siblings: SavedMoveTreeNode[] | undefined = nodes;
  let endpoint: SavedMoveTreeNode | undefined;
  for (const uci of moves) {
    endpoint = siblings?.find(node => node.uci === uci);
    if (!endpoint) return undefined;
    siblings = endpoint.children;
  }
  return endpoint;
}

function contentRow(node: SavedMoveTreeNode, depth: number, legacyResult?: RecordedResult) {
  return [depth, node.uci, normalizeMoveComment(node.comment), node.nags?.length ? node.nags : undefined, node.recordedResult ?? legacyResult, node.analysis];
}
