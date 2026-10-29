import type React from 'react';
import { IconX, IconUpload } from './icons';
import { GAME_MODES, type GameMode } from '../utils/gameModes';
import { type AiStrength, describeAiStrength, AI_STRENGTH_LABELS } from '../utils/aiOpponent';
import { isComposingKey } from '../utils/keyboard';
import { isMoveImportTextTooLarge, MAX_MOVE_IMPORT_UCI_MOVES } from '../utils/moveImport';
import { type BoardState, type Side } from '../utils/xiangqi';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useStoreSelector } from '../hooks/useStoreSelector';
import type { NewGameFormStore } from '../utils/newGameForm';
import { readFenBoard } from '../utils/positionSetup';


export interface NewGameDialogProps {
  closeNewGameMenu: () => void;
  newGameDialogRef: React.MutableRefObject<HTMLDivElement | null>;
  aiStrength: AiStrength;
  setAiStrength: React.Dispatch<React.SetStateAction<AiStrength>>;
  handleLoadFen: (fen: string, nextGameMode?: GameMode, note?: string) => boolean;
  clearFenError: () => void;
  setEditorGameMode: React.Dispatch<React.SetStateAction<GameMode | null>>;
  setEditorSeed: React.Dispatch<React.SetStateAction<{ board: BoardState; sideToMove: Side; } | null>>;
  setShowBoardEditor: React.Dispatch<React.SetStateAction<boolean>>;
  handleUndoMoveLineFile: () => void;
  directImportCancelRef: React.MutableRefObject<HTMLButtonElement | null>;
  directImportFocusRef: React.MutableRefObject<HTMLElement | null>;
  handleImportMoveLine: (text: string, nextGameMode?: GameMode) => Promise<void>;
  handleMoveLineFileDrop: (event: React.DragEvent<HTMLTextAreaElement>) => void;
  cancelDirectImport: () => void;
  viewportSize: { width: number; height: number; };
  handlePickMoveLineFile: () => void;
  moveLineFileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  handleMoveLineFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  startNewGameFromMenu: () => void;
  form: NewGameFormStore;
  initialFocus: 'default' | 'import';
}

export function NewGameDialog({
  closeNewGameMenu,
  newGameDialogRef,
  aiStrength,
  setAiStrength,
  handleLoadFen,
  clearFenError,
  setEditorGameMode,
  setEditorSeed,
  setShowBoardEditor,
  handleUndoMoveLineFile,
  directImportCancelRef,
  directImportFocusRef,
  handleImportMoveLine,
  handleMoveLineFileDrop,
  cancelDirectImport,
  viewportSize,
  handlePickMoveLineFile,
  moveLineFileInputRef,
  handleMoveLineFileChange,
  startNewGameFromMenu,
  form,
  initialFocus
}: NewGameDialogProps) {
  const { pendingGameMode, fenInput, fenError, directImportBusy, moveLineFileDragActive, moveLineInput, moveLineFileName, moveLineFileUndo, moveLineError } = useStoreSelector(form, value => value);
  const { pendingGameMode: setPendingGameMode, fenInput: setFenInput, moveLineFileDragActive: setMoveLineFileDragActive, moveLineInput: setMoveLineInput, moveLineFileName: setMoveLineFileName, moveLineFileUndo: setMoveLineFileUndo, moveLineError: setMoveLineError } = form.setters;
  const pendingModeMeta = GAME_MODES.find(candidate => candidate.mode === pendingGameMode) ?? GAME_MODES[0];
  const pendingModeLabel = pendingModeMeta.label;
  const pendingModeIsAi = pendingGameMode !== 'PvP';
  const refusedPosition = useMemo(() => fenError ? readFenBoard(fenInput) : null, [fenError, fenInput]);
  useDialogFocus(newGameDialogRef);
  useEffect(() => { if (initialFocus === 'import') { const input = document.getElementById('new-game-line-input'); input?.focus(); input?.scrollIntoView({ block: 'nearest' }); } }, [initialFocus]);
  useLayoutEffect(() => { cancelDirectImport(); setMoveLineFileDragActive(false); }, [cancelDirectImport, setMoveLineFileDragActive, pendingGameMode, fenInput]);
  useLayoutEffect(() => { const target = directImportFocusRef.current; if (!directImportBusy && target?.isConnected && document.activeElement === document.body) target.focus(); }, [directImportBusy, directImportFocusRef]);
  return (
        <>
          <div
            className="settings-backdrop"
            onClick={closeNewGameMenu}
            aria-hidden="true"
          />
          <div
            className="new-game-menu"
            role="dialog"
            aria-modal="true"
            aria-label="New game"
            id="new-game-menu-dialog"
            data-testid="new-game-dialog"
            ref={newGameDialogRef}
            tabIndex={-1}
          >
            <div className="new-game-menu-header">
              <div className="new-game-menu-copy">
                <h2>New Game</h2>
              </div>
              <button
                className="settings-close-btn"
                type="button"
                onClick={closeNewGameMenu}
                aria-label="Close"
              >
                <IconX />
              </button>
            </div>
            <div className="new-game-menu-content" tabIndex={-1} onFocusCapture={event => {
              if (event.target instanceof HTMLElement) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}>
            <div className="new-game-menu-modes">
              {GAME_MODES.map(({ mode, label, description }) => (
                <button
                  key={mode}
                  type="button"
                  className={`new-game-mode-btn ${pendingGameMode === mode ? 'new-game-mode-btn-active' : ''}`}
                  onClick={() => setPendingGameMode(mode)}
                  aria-pressed={pendingGameMode === mode}
                >
                  <span>{label}</span>
                  <small>{description}</small>
                </button>
              ))}
            </div>
            {pendingModeIsAi && (
              <div className="new-game-strength-section">
                <p className="new-game-strength-label">AI Difficulty</p>
                <div className="new-game-strength-pills">
                  {([1, 2, 3, 4, 5, 6] as AiStrength[]).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={`new-game-strength-btn ${aiStrength === lvl ? 'new-game-strength-btn-active' : ''}`}
                      onClick={() => setAiStrength(lvl)}
                      title={describeAiStrength(lvl)}
                      aria-label={describeAiStrength(lvl)}
                      aria-pressed={aiStrength === lvl}
                    >
                      {AI_STRENGTH_LABELS[lvl]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="new-game-fen-section">
              <p className="new-game-strength-label">Load Position (FEN)</p>
              <form
                className="new-game-fen-form"
                onSubmit={(e) => { e.preventDefault(); handleLoadFen(fenInput, pendingGameMode); }}
              >
                <input
                  className={`new-game-fen-input ${fenError ? 'new-game-fen-input-error' : ''}`}
                  type="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={fenInput}
                  onChange={(e) => {
                    setFenInput(e.target.value);
                    if (fenError) clearFenError();
                  }}
                  placeholder="rnbakabnr/9/… w - - 0 1"
                  aria-label="FEN string"
                  aria-invalid={fenError ? true : undefined}
                  aria-describedby={fenError ? 'new-game-fen-error' : undefined}
                />
                <button
                  type="submit"
                  className="new-game-strength-btn new-game-strength-btn-active"
                  disabled={!fenInput.trim()}
                >
                  {fenError ? 'Invalid FEN' : 'Load'}
                </button>
              </form>
              {fenError ? (
                <span id="new-game-fen-error" className="new-game-fen-error" role="alert">
                  {fenError}
                </span>
              ) : null}
              {/* For the position nobody has a FEN for: the endgame in a
                  book, a composed problem, the one a friend described -- and,
                  when a pasted FEN drew a board and broke a rule, for that
                  board. Being told the generals face each other and then having
                  to rebuild the whole position to move one of them is the long
                  way round; the editor holds an illegal board on purpose, says
                  the same sentence about it, and keeps Done disabled until it
                  is answered. Only when the layout itself parsed: there is
                  nothing to hand over otherwise, and the button goes back to
                  meaning what it always meant. */}
              <button
                type="button"
                className="new-game-file-btn"
                style={{ marginTop: '0.5rem' }}
                onClick={() => {
                  setEditorGameMode(pendingGameMode);
                  setEditorSeed(refusedPosition);
                  closeNewGameMenu();
                  setShowBoardEditor(true);
                }}
                data-testid="open-board-editor-btn"
              >
                {refusedPosition ? 'Fix this position by hand' : 'Set up the board by hand'}
              </button>
            </div>
            <div className="new-game-fen-section">
              <p className="new-game-strength-label">Import Move Line</p>
              <form
                className="new-game-line-form"
                onKeyDown={event => {
                  if (!moveLineFileUndo || isComposingKey(event.nativeEvent) || !(event.ctrlKey || event.metaKey)
                    || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
                  event.preventDefault(); event.stopPropagation(); handleUndoMoveLineFile();
                }}
                onFocusCapture={event => {
                  if (!(event.target instanceof HTMLElement)) return;
                  if (!event.target.isSameNode(directImportCancelRef.current)) directImportFocusRef.current = event.target;
                  else if (!directImportFocusRef.current?.isConnected) directImportFocusRef.current = document.getElementById('new-game-line-input');
                }}
                onSubmit={(e) => { e.preventDefault(); handleImportMoveLine(moveLineInput, pendingGameMode); }}
              >
                <textarea
                  id="new-game-line-input"
                  className={`new-game-line-input ${moveLineError ? 'new-game-fen-input-error' : ''}`}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={moveLineInput}
                  data-file-drag={moveLineFileDragActive || undefined}
                  onDragLeave={() => setMoveLineFileDragActive(false)}
                  onDragEnd={() => setMoveLineFileDragActive(false)}
                  onDragOver={event => {
                    if (!event.dataTransfer.types.includes('Files')) return;
                    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
                    setMoveLineFileDragActive(true);
                  }}
                  onDrop={handleMoveLineFileDrop}
                  onChange={(e) => {
                    cancelDirectImport();
                    const nextValue = e.target.value;
                    if (isMoveImportTextTooLarge(nextValue)) {
                      setMoveLineError(`Move line is too large. Import ${MAX_MOVE_IMPORT_UCI_MOVES} moves or fewer.`);
                      return;
                    }
                    setMoveLineFileName('');
                    setMoveLineFileUndo(null);
                    setMoveLineInput(nextValue);
                    setMoveLineError(null);
                  }}
                  placeholder="1. 炮二平五 马8进7   ·   1. C2=5 H8+7   ·   1. b2e2 h9g7"
                  aria-label="Move line in coordinates, WXF or Chinese notation"
                  aria-invalid={moveLineError ? true : undefined}
                  aria-describedby={moveLineError ? 'new-game-line-error new-game-line-drop-hint' : 'new-game-line-drop-hint'}
                  rows={viewportSize.height <= 500 ? 2 : 3}
                  data-testid="uci-line-input"
                />
                <p id="new-game-line-drop-hint" className="settings-hint">Drop a PGN, XQF or text file here.</p>
                <div className="new-game-file-row">
                  <button
                    type="button"
                    className="new-game-file-btn"
                    onClick={handlePickMoveLineFile}
                    data-testid="load-uci-file-btn"
                  >
                    <IconUpload /> Open PGN or XQF
                  </button>
                  <input
                    ref={moveLineFileInputRef}
                    className="new-game-file-input"
                    type="file"
                    accept=".pgn,.txt,.xqf,text/plain,application/x-chess-pgn,application/octet-stream"
                    onChange={handleMoveLineFileChange}
                    aria-label="Open PGN file"
                    data-testid="uci-line-file-input"
                  />
                  {moveLineFileName ? <span className="new-game-file-name" title={moveLineFileName}>{moveLineFileName}</span> : null}
                  {moveLineFileUndo && <button type="button" className="new-game-file-btn" onClick={handleUndoMoveLineFile}
                    title="Undo file load (Ctrl/Cmd+Z)" aria-keyshortcuts="Control+Z Meta+Z">Undo file load</button>}
                </div>
                {directImportBusy && <p role="status">Checking the game… <button type="button" ref={directImportCancelRef} onClick={cancelDirectImport}>Cancel reading</button></p>}
                <div className="new-game-line-actions">
                  {moveLineError ? <span id="new-game-line-error" className="new-game-line-error" role="alert">{moveLineError}</span> : <span />}
                  <button
                    type="submit"
                    className="new-game-strength-btn new-game-strength-btn-active"
                    disabled={directImportBusy || !moveLineInput.trim()}
                    data-testid="import-uci-line-btn"
                  >
                    {directImportBusy ? 'Reading…' : 'Import'}
                  </button>
                </div>
              </form>
            </div>
            </div>
            <div className="new-game-menu-footer">
              <div className="new-game-selection" aria-label={`Selected ${pendingModeLabel}. ${pendingModeMeta.description}`}>
                <span className="new-game-selection-label">Selected</span>
                <strong>{pendingModeLabel}</strong>
              </div>
              <button
                type="button"
                className="new-game-start-btn"
                onClick={startNewGameFromMenu}
              >
                Start Fresh Board
              </button>
            </div>
          </div>
        </>
  );
}
