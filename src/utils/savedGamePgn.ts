import type { SavedGame } from './gameLibrary';
import { exportPgnFromMoveTree, exportPgnFromUci } from './gameExport';

/** Only the portable record; omit library identity and the full review report. */
export type SavedGamePgnInput = Pick<SavedGame, 'moves' | 'moveTree' | 'gameMode' | 'opening' | 'result' | 'label'
  | 'metadata' | 'startFen' | 'rootComment' | 'rootResult' | 'mainLinePinned' | 'moveTreePath'>;

export function savedGamePgnInput(game: SavedGame): SavedGamePgnInput {
  return { moves: game.moves, moveTree: game.moveTree, gameMode: game.gameMode, opening: game.opening,
    result: game.result, label: game.label, metadata: game.metadata, startFen: game.startFen,
    rootComment: game.rootComment, rootResult: game.rootResult, mainLinePinned: game.mainLinePinned,
    ...(game.moveTreePath ? { moveTreePath: game.moveTreePath } : {}) };
}

/** Null means the saved path cannot be exported without losing the tree. */
export function buildSavedGamePgn(game: SavedGamePgnInput): string | null {
  const options = {
    gameMode: game.gameMode, opening: game.opening,
    result: game.result === 'red' ? 'red-wins' as const : game.result === 'black' ? 'black-wins' as const : game.result === 'draw' ? 'draw' as const : null,
    label: game.label, metadata: game.metadata, startFen: game.startFen,
    rootComment: game.rootComment, rootResult: game.rootResult, mainLinePinned: game.mainLinePinned,
  };
  // Never substitute a flat record when its tree contains a different path.
  return game.moveTree?.length
    ? exportPgnFromMoveTree(game.moveTree, { ...options, mainLineMoves: game.moves, mainLineTreePath: game.moveTreePath })
    : exportPgnFromUci(game.moves, options);
}
