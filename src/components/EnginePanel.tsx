import type React from 'react';
import { IconPause, IconSearch, IconTarget, IconBarChart, IconRefresh, IconCheck, IconPlay, IconX, IconCopy, IconSave } from './icons';
import { DeferredCandidatePanel as CandidatePanel } from './DeferredAnalysisPanels';
import { hasMoveTreeLine } from '../utils/appendMoveTreeLine';
import { formatRedPovEngineScore, normalizeEvalForSide, normalizeWdlForSide } from '../utils/engineScore';
import { formatLineInStyle, formatLineTokensInStyle, type XiangqiNotationStyle } from '../utils/xiangqiNotation';
import { parseFenBoard, type BoardState, type Side } from '../utils/xiangqi';
import { describePvStanding } from '../utils/pvStanding';
import { MoveLineStrip } from './Controls/MoveLineStrip';
import { EngineSearchTelemetry, EngineOutput } from './EngineTelemetry';
import { describeAnalysisActivity, formatAnalysisActivity } from '../utils/analysisActivity';
import { type CandidateSearch } from '../utils/candidateSearch';
import { type AnalysisEngineMode, type AssistMode, type DeepSearchMode, type PvLineCount } from '../utils/preferences';
import type { EngineNotice, EngineHashFeedback, ExportFailureKey } from '../utils/appUiTypes';
import type { EngineTelemetryStore } from '../utils/engineTelemetryStore';
import type { SelectorStore } from '../utils/selectorStore';
import type { PvLine } from '../hooks/useEngine';
import { useStoreSelector } from '../hooks/useStoreSelector';
import { parseAnalysisTag, parseThreatTag } from '../utils/engineTags';
import { parseCandidateTag } from '../utils/candidateSearch';
type SearchBudget = ReturnType<typeof import('../utils/analysisProfile').resolveDeepDiveBudget>;

const PV_LINE_OPTIONS: PvLineCount[] = [1, 3, 5];
const PV_LINE_CONTROL_COPY: Record<PvLineCount, { ariaLabel: string; title: string }> = {
  1: {
    ariaLabel: 'Set principal variation lines to 1, fastest best-move search',
    title: 'Show 1 engine line for the fastest best-move search.',
  },
  3: {
    ariaLabel: 'Set principal variation lines to 3, compare main candidates',
    title: 'Show 3 engine lines to compare main candidate moves.',
  },
  5: {
    ariaLabel: 'Set principal variation lines to 5, broad option scan',
    title: 'Show 5 engine lines for a broader option scan. This uses more engine time.',
  },
};

export interface EnginePanelProps {
  enginePvLineCount: PvLineCount;
  setEnginePvLineCount: React.Dispatch<React.SetStateAction<PvLineCount>>;
  deepDiveActive: boolean;
  stopDeepDive: () => void;
  runDeepDive: () => void;
  canDeepDive: boolean;
  deepSearchMode: DeepSearchMode;
  deepDiveBudget: SearchBudget;
  deepSearchLimitText: string;
  setDeepSearchMode: React.Dispatch<React.SetStateAction<DeepSearchMode>>;
  threatActive: boolean;
  stopThreat: () => void;
  runThreatSearch: () => void;
  canShowThreat: boolean;
  threatFen: string | null;
  sideToMoveLabel: "Red" | "Black";
  sideToMove: Side;
  candidateButtonRef: React.RefObject<HTMLButtonElement>;
  candidatePickerOpen: boolean;
  closeCandidatePicker: () => void;
  openCandidatePicker: () => void;
  canCompareCandidates: boolean;
  handleRestartEngine: () => void;
  engineRequired: boolean;
  engineHashFeedback: EngineHashFeedback;
  handleClearEngineHash: () => void;
  isReady: boolean;
  isSearching: boolean;
  isSearchQueued: boolean;
  engineRecoveryNotice: EngineNotice;
  engineRecoveryHint: "Select Restart to try again." | "Analysis resumes when the engine is ready.";
  currentPositionCommand: string;
  board: BoardState;
  notationStyle: XiangqiNotationStyle;
  candidateActive: boolean;
  candidateSearch: CandidateSearch | null;
  gameResult: import("../hooks/useXiangqi").GameResult;
  isAiTurn: boolean;
  reviewStatus: import("../hooks/useGameReview").ReviewStatus;
  candidateBudgetLabel: string;
  compareCandidateMoves: (moves: string[], deep?: boolean) => void;
  leaveCandidateSearch: () => void;
  handlePlayPvLine: (moves: string[], count: number) => void;
  handleKeepPvLine: (moves: string[]) => void;
  isAnalysisLineKept: (moves: string[]) => boolean;
  treeNodes: Record<string, import("../hooks/useXiangqi").MoveTreeNode>;
  currentNodeId: string;
  currentFen: string;
  exportFailureKey: ExportFailureKey | null;
  copiedPvIndex: number | null;
  spotlightPvIndex: number | null;
  setSpotlightPvIndex: React.Dispatch<React.SetStateAction<number | null>>;
  handlePlayPvMove: (uci: string | undefined) => void;
  handleCopyPvLine: (lineIndex: number, moves: string[]) => Promise<void>;
  engineCoreDetail: string;
  engineVariant: string;
  engineBootConfig: import("../utils/analysisProfile").EngineBootConfig;
  analysisEngineMode: AnalysisEngineMode;
  telemetry: EngineTelemetryStore;
  analysisIsStalled: boolean;
  analysisActivity: import("../utils/analysisActivity").AnalysisActivity;
  analysisMultiPv: PvLineCount;
  analysisWdlEnabled: boolean;
  assistMode: AssistMode;
  liveAnalysisPolicy: import("../utils/analysisProfile").LiveAnalysisPolicy;
  recommendations: SelectorStore<PvLine[]>;
  analysisRequestKey: string;
  engineEnabled: boolean;
}

export function EnginePanel({
  enginePvLineCount,
  setEnginePvLineCount,
  deepDiveActive,
  stopDeepDive,
  runDeepDive,
  canDeepDive,
  deepSearchMode,
  deepDiveBudget,
  deepSearchLimitText,
  setDeepSearchMode,
  threatActive,
  stopThreat,
  runThreatSearch,
  canShowThreat,
  threatFen,
  sideToMoveLabel,
  sideToMove,
  candidateButtonRef,
  candidatePickerOpen,
  closeCandidatePicker,
  openCandidatePicker,
  canCompareCandidates,
  handleRestartEngine,
  engineRequired,
  engineHashFeedback,
  handleClearEngineHash,
  isReady,
  isSearching,
  isSearchQueued,
  engineRecoveryNotice,
  engineRecoveryHint,
  currentPositionCommand,
  board,
  notationStyle,
  candidateActive,
  candidateSearch,
  gameResult,
  isAiTurn,
  reviewStatus,
  candidateBudgetLabel,
  compareCandidateMoves,
  leaveCandidateSearch,
  handlePlayPvLine,
  handleKeepPvLine,
  isAnalysisLineKept,
  treeNodes,
  currentNodeId,
  currentFen,
  exportFailureKey,
  copiedPvIndex,
  spotlightPvIndex,
  setSpotlightPvIndex,
  handlePlayPvMove,
  handleCopyPvLine,
  engineCoreDetail,
  engineVariant,
  engineBootConfig,
  analysisEngineMode,
  telemetry,
  analysisIsStalled,
  analysisActivity,
  analysisMultiPv,
  analysisWdlEnabled,
  assistMode,
  liveAnalysisPolicy,
  recommendations,
  analysisRequestKey,
  engineEnabled
}: EnginePanelProps) {
  const lines = useStoreSelector(recommendations, value => value);
  const currentAnalysisPvLines = engineEnabled ? lines.filter(pv => parseAnalysisTag(pv.searchTag)?.requestKey === analysisRequestKey) : [];
  const candidatePvLines = candidateActive && candidateSearch ? lines.filter(pv => parseCandidateTag(pv.searchTag) === candidateSearch.key && candidateSearch.moves.includes(pv.moves[0])) : [];
  const threatPv = threatActive ? lines.find(pv => parseThreatTag(pv.searchTag)?.requestKey === analysisRequestKey) ?? null : null;
  const topAnalysisPv = currentAnalysisPvLines[0] ?? null;
  const coachBestMoveText = topAnalysisPv?.moves[0] ? formatLineInStyle(board, [topAnalysisPv.moves[0]], notationStyle, 1) : isSearchQueued || isSearching ? 'Waiting for engine' : 'No engine move yet';
  const coachLineText = topAnalysisPv?.moves.length ? formatLineInStyle(board, topAnalysisPv.moves, notationStyle, 5) : isSearchQueued || isSearching ? 'Waiting for engine line' : 'No engine line yet';
  return (
                <>
                  <div className="engine-pv-controls" role="group" aria-label="Engine principal variation lines">
                    <span>PV Lines</span>
                    <div className="engine-pv-buttons">
                      {PV_LINE_OPTIONS.map((count) => (
                        <button
                          key={count}
                          type="button"
                          className={`engine-pv-btn ${enginePvLineCount === count ? 'engine-pv-btn-active' : ''}`}
                          onClick={() => setEnginePvLineCount(count)}
                          aria-pressed={enginePvLineCount === count}
                          aria-label={PV_LINE_CONTROL_COPY[count].ariaLabel}
                          title={PV_LINE_CONTROL_COPY[count].title}
                          data-testid={`engine-pv-lines-${count}`}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="engine-pv-controls engine-runtime-controls" role="group" aria-label="Engine runtime controls">
                    <span>Runtime</span>
                    <div className="engine-runtime-buttons">
                      {/* The one thing live analysis cannot do: stop on this
                          position and go as deep as the machine can. Bounded,
                          so it settles on its own; stoppable, so a long wait is
                          never forced on anyone. */}
                      <button
                        type="button"
                        className={`engine-cache-btn ${deepDiveActive ? 'engine-pv-btn-active' : ''}`}
                        onClick={deepDiveActive ? stopDeepDive : runDeepDive}
                        disabled={!deepDiveActive && !canDeepDive}
                        title={deepDiveActive
                          ? 'Stop the deep search and keep what it has found (D)'
                          : deepSearchMode === 'infinite'
                            ? 'Search this position until stopped, including while this tab is in the background (D)'
                            : `Search this position to depth ${deepDiveBudget.depth} for up to ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s, and keep going if this tab goes to the background (D)`}
                        aria-keyshortcuts="D"
                        aria-label={deepDiveActive
                          ? 'Stop the deep search'
                          : `Go deep: search this position, ${deepSearchLimitText}`}
                        data-testid="deep-dive-btn"
                      >
                        {deepDiveActive
                          ? <><IconPause aria-hidden="true" focusable="false" /> Stop</>
                          : <><IconSearch aria-hidden="true" focusable="false" /> Go Deep</>}
                      </button>
                      {/* The other way a deep search can end: never, until the
                          reader says so. Pressed, Go Deep sends `go infinite`
                          and the depth climbs until Stop or a new position.
                          A toggle beside the button rather than a setting,
                          because it is decided per position, not per session. */}
                      <button
                        type="button"
                        className={`engine-cache-btn engine-infinite-btn ${deepSearchMode === 'infinite' ? 'engine-pv-btn-active' : ''}`}
                        onClick={() => setDeepSearchMode((mode) => (mode === 'infinite' ? 'bounded' : 'infinite'))}
                        aria-pressed={deepSearchMode === 'infinite'}
                        title={deepSearchMode === 'infinite'
                          ? `Deep search runs until stopped. Press to limit it to ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s.`
                          : `Deep search stops after ${Math.round(deepDiveBudget.moveTimeMs / 1000)}s. Press to let it run until stopped.`}
                        aria-label="Let a deep search run until stopped"
                        data-testid="deep-infinite-toggle"
                      >
                        ∞
                      </button>
                      {/* Give the opponent the move and read the reply. The
                          button says why it is unavailable rather than sitting
                          disabled with no account of itself -- being in check is
                          the common reason and it is not obvious that it is one. */}
                      <button
                        type="button"
                        className={`engine-cache-btn ${threatActive ? 'engine-pv-btn-active' : ''}`}
                        onClick={threatActive ? stopThreat : runThreatSearch}
                        disabled={!threatActive && !canShowThreat}
                        title={threatActive
                          ? 'Back to analysing the position as it stands (X)'
                          : !threatFen
                            ? `${sideToMoveLabel} is in check, so there is no position to pass from`
                            : `Let ${sideToMove === 'w' ? 'Black' : 'Red'} move first and show what they are threatening (X)`}
                        aria-keyshortcuts="X"
                        aria-label={threatActive
                          ? 'Threat on: stop showing the threat and analyse the position as it stands'
                          : 'Show the threat: let the opponent move first'}
                        data-testid="show-threat-btn"
                      >
                        <IconTarget aria-hidden="true" focusable="false" /> {threatActive ? 'Threat on' : 'Threat'}
                      </button>
                      <button
                        type="button"
                        ref={candidateButtonRef}
                        className={`engine-cache-btn ${candidatePickerOpen ? 'engine-pv-btn-active' : ''}`}
                        onClick={candidatePickerOpen ? closeCandidatePicker : openCandidatePicker}
                        disabled={!candidatePickerOpen && !canCompareCandidates}
                        aria-expanded={candidatePickerOpen}
                        aria-controls={candidatePickerOpen ? 'candidate-comparison' : undefined}
                        title="Choose legal moves and compare only their continuations"
                        data-testid="open-candidate-comparison"
                      >
                        <IconBarChart aria-hidden="true" /> Compare
                      </button>
                      <details className="engine-advanced" data-testid="advanced-engine-maintenance">
                        <summary>Engine maintenance</summary>
                        <p>Restart a stalled engine or clear remembered search positions.</p>
                        <div className="engine-advanced-actions">
                      <button
                        type="button"
                        className="engine-cache-btn"
                        onClick={handleRestartEngine}
                        disabled={!engineRequired}
                        title="Restart the engine worker"
                        aria-label="Restart engine"
                        data-testid="restart-engine-btn"
                      >
                        <IconRefresh aria-hidden="true" focusable="false" /> Restart
                      </button>
                      <button
                        type="button"
                        className={`engine-cache-btn ${engineHashFeedback ? 'engine-pv-btn-active' : ''}`}
                        onClick={handleClearEngineHash}
                        disabled={!isReady}
                        title={engineHashFeedback === 'queued' ? 'Engine hash clear is queued after the current search' : isSearching || isSearchQueued ? 'Queue a transposition-table clear after the current search' : 'Clear the engine hash table'}
                        aria-label={engineHashFeedback === 'queued' ? 'Engine hash clear queued' : engineHashFeedback === 'cleared' ? 'Engine hash cleared' : 'Clear hash: empty the engine search table'}
                        data-testid="clear-engine-hash-btn"
                      >
                        {engineHashFeedback === 'queued' ? <><IconRefresh aria-hidden="true" focusable="false" /> Queued</> : engineHashFeedback === 'cleared' ? <><IconCheck aria-hidden="true" focusable="false" /> Cleared</> : 'Clear Hash'}
                      </button>
                        </div>
                      </details>
                    </div>
                  </div>
                  {engineRecoveryNotice ? (
                    <div
                      className={`engine-recovery-notice engine-recovery-notice-${engineRecoveryNotice.tone}`}
                      role="status"
                      data-testid="engine-recovery-notice"
                    >
                      <strong>{engineRecoveryNotice.text}</strong>
                      <span>{engineRecoveryHint}</span>
                    </div>
                  ) : null}
                  {candidatePickerOpen ? (
                    <CandidatePanel
                      key={currentPositionCommand}
                      board={board} side={sideToMove} notation={notationStyle}
                      active={candidateActive} completed={candidateSearch?.completed ?? false}
                      searching={candidateActive && (isSearching || isSearchQueued)}
                      canCompare={canCompareCandidates}
                      canPlay={isReady && !gameResult && !isAiTurn && reviewStatus !== 'running'}
                      budgetLabel={candidateActive ? candidateSearch!.budgetLabel : candidateBudgetLabel}
                      lines={candidatePvLines}
                      onCompare={compareCandidateMoves} onEdit={leaveCandidateSearch} onClose={closeCandidatePicker}
                      onStop={stopDeepDive}
                      onPlay={handlePlayPvLine} onKeep={handleKeepPvLine}
                      isKept={isAnalysisLineKept} hasLine={moves => hasMoveTreeLine(treeNodes, currentNodeId, moves)}
                    />
                  ) : null}
                  {/* The threat replaces the candidate list rather than sitting
                      beside it, because the two are evaluations of different
                      positions and a reader comparing them side by side would be
                      comparing nothing. The card says whose move it is showing. */}
                  {candidateActive ? null : threatActive ? (
                    <div className="pv-lines-container">
                      <div className="pv-line premium-card threat-card" data-testid="threat-card">
                        <div className="pv-line-heading">
                          <span className="pv-line-rank">
                            If {sideToMove === 'w' ? 'Black' : 'Red'} moved now
                          </span>
                          {/* Red POV like every other evaluation here, and said
                              so, because this one is a score for a position the
                              reader is not looking at -- an unlabelled number
                              beside "If Black moved now" reads as Black's. The
                              side passed to the formatter is the *opponent*,
                              since that is who is to move in the searched
                              position. */}
                          {threatPv ? (
                            <span
                              className="pv-line-standing"
                              title={`Red POV score ${formatRedPovEngineScore(threatPv, sideToMove === 'w' ? 'b' : 'w')}`}
                            >
                              {formatRedPovEngineScore(threatPv, sideToMove === 'w' ? 'b' : 'w')} Red POV
                            </span>
                          ) : null}
                        </div>
                        <div className="pv-line-moves" data-testid="threat-line">
                          {threatPv
                            ? formatLineInStyle(
                                parseFenBoard((threatFen ?? currentFen).split(' ')[0]),
                                threatPv.moves,
                                notationStyle,
                                6,
                              )
                            : 'Searching…'}
                        </div>
                        <div className="pv-empty">
                          A passed move: this position is not one the game can reach.
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="pv-lines-container">
                    {currentAnalysisPvLines.length === 0 ? (
                      <div className="pv-empty">No PV available yet.</div>
                    ) : currentAnalysisPvLines.map((pv, i) => {
                      const bestReading = currentAnalysisPvLines[0] ?? pv;
                      const lineStanding = describePvStanding(bestReading, pv, i);
                      const normalizedScore = normalizeEvalForSide(pv.score, sideToMove);
                      // One decimal, like every other evaluation in the app.
                      // At zero this badge could not tell a half-pawn from
                      // level -- everything between -0.99 and +0.99 rendered as
                      // "+0" or "-0", which is most of an opening and most of a
                      // middlegame, and "-0" reads as a typo rather than as a
                      // number. The screen-reader label had already been built
                      // at one decimal all along, so the informative form
                      // existed and was simply not the one on screen.
                      const pvScoreText = formatRedPovEngineScore(pv, sideToMove, 1);
                      const pvScoreLabel = `Red POV score ${pvScoreText}`;
                      const pvScoreClass = normalizedScore > 0 ? 'positive' : normalizedScore < 0 ? 'negative' : '';
                      const firstMove = pv.moves[0];
                      const lineExists = hasMoveTreeLine(treeNodes, currentNodeId, pv.moves);
                      const lineKept = isAnalysisLineKept(pv.moves);
                      const depthLabel = pv.depth ? `depth ${pv.depth}` : 'depth pending';
                      const pvLineText = pv.moves.length ? formatLineInStyle(board, pv.moves, notationStyle, 7) : 'No moves yet';
                      const pvTokens = formatLineTokensInStyle(board, pv.moves, notationStyle, 7);
                      const pvLineLabel = pv.moves.length ? `moves ${pvLineText}` : 'no moves yet';
                      const firstMoveText = firstMove ? formatLineInStyle(board, [firstMove], notationStyle, 1) : '';
                      // The clipboard gets the raw moves whatever the reader is
                      // looking at, so the tooltip shows those rather than
                      // promising "raw UCI" beside a line written in WXF.
                      const pvRawLine = pv.moves.join(' ');
                      const lineActionContext = `engine line ${i + 1}, ${depthLabel}, ${pvLineLabel}`;
                      // Red's chances, like every other number on this card:
                      // the engine's wdl is for the side to move.
                      const lineWdl = pv.wdl ? normalizeWdlForSide(pv.wdl, sideToMove) : null;
                      const lineWdlText = lineWdl
                        ? `Red ${Math.round(lineWdl.win / 10)}% · draw ${Math.round(lineWdl.draw / 10)}% · Black ${Math.round(lineWdl.loss / 10)}%`
                        : null;
                      const playPvLabel = firstMove
                        ? `Play ${firstMoveText} from engine line ${i + 1}`
                        : `Play engine line ${i + 1} first move unavailable`;
                      const copyPvLabel = exportFailureKey === `copy-pv-${i}`
                        ? `Engine line ${i + 1} copy failed: ${pvLineText}`
                        : copiedPvIndex === i
                          ? `Engine line ${i + 1} copied: ${pvLineText}`
                          : `Copy engine line ${i + 1}: ${pvLineText}`;
                      return (
                        <div
                          key={i}
                          className={`pv-line premium-card ${spotlightPvIndex === i ? 'pv-line-spotlight' : ''}`}
                          role="group"
                          tabIndex={0}
                          aria-label={`Engine line ${i + 1}, ${lineStanding}, ${pvScoreLabel}, ${depthLabel}${lineWdlText ? `, ${lineWdlText}` : ''}, ${pvLineLabel}`}
                          onMouseEnter={() => setSpotlightPvIndex(i)}
                          onMouseLeave={() => setSpotlightPvIndex(null)}
                          onFocus={() => setSpotlightPvIndex(i)}
                          onBlur={(event) => {
                            const nextFocus = event.relatedTarget;
                            if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
                            setSpotlightPvIndex(null);
                          }}
                          data-testid={`engine-pv-line-${i}`}
                          data-spotlight={spotlightPvIndex === i ? 'true' : undefined}
                        >
                          <div
                            className={['pv-score', pvScoreClass].filter(Boolean).join(' ')}
                            aria-label={pvScoreLabel}
                            title={pvScoreLabel}
                            data-testid={`engine-pv-score-${i}`}
                          >
                            <strong>{pvScoreText}</strong>
                            <span>Red POV</span>
                          </div>
                          <div className="pv-moves">
                            <div className="pv-line-heading">
                              <span className="pv-line-rank">Line {i + 1}</span>
                              <span
                                className={`pv-line-standing ${lineStanding === 'Best' ? 'pv-line-standing-best' : ''}`}
                                title={lineStanding === 'Not exact'
                                  ? i === 0
                                    ? 'This score is a bound; an exact evaluation is not available yet.'
                                    : 'At least one score is a bound, so an exact comparison is not available yet.'
                                  : i === 0 ? 'The engine’s first principal variation.'
                                  : 'Compared with Line 1 from the side to move’s perspective. Live scores can update at different times.'}
                              >
                                {lineStanding}
                              </span>
                            </div>
                            <span className="turnNum">
                              Depth {pv.depth}
                              {lineWdlText ? <span className="pv-line-wdl" title={lineWdlText} data-testid={`engine-pv-wdl-${i}`}> · {lineWdlText}</span> : null}
                            </span>
                            <span className="move">
                              {/* One control per move: click the third to play the
                                  line up to it, which is what a strong player does
                                  with an engine line and could not do here. */}
                              <MoveLineStrip
                                tokens={pvTokens.tokens}
                                remaining={pvTokens.remaining}
                                disabled={Boolean(gameResult)}
                                onPlay={(count) => handlePlayPvLine(pv.moves, count)}
                                title={(_, token) => `Play this line up to ${token}`}
                                ariaLabel={(moveIndex, token) => `Play engine line ${i + 1} up to move ${moveIndex + 1}, ${token}`}
                                testId={(moveIndex) => `engine-pv-${i}-move-${moveIndex}`}
                                emptyText="No moves yet"
                              />
                            </span>
                          </div>
                          <div className="pv-line-actions" role="group" aria-label={`Actions for ${lineActionContext}`}>
                            <button
                              type="button"
                              className="pv-action-btn"
                              onClick={() => handlePlayPvMove(firstMove)}
                              disabled={!firstMove || Boolean(gameResult)}
                              title={firstMove ? `Play ${firstMoveText} from this engine line` : 'No move to play from this engine line'}
                              aria-label={playPvLabel}
                              data-testid={`play-engine-pv-${i}`}
                            >
                              <IconPlay />
                              <span>Play</span>
                            </button>
                            <button
                              type="button"
                              className={`pv-action-btn ${copiedPvIndex === i ? 'pv-action-btn-active' : ''} ${exportFailureKey === `copy-pv-${i}` ? 'pv-action-btn-warning' : ''}`}
                              onClick={() => handleCopyPvLine(i, pv.moves)}
                              disabled={pv.moves.length === 0}
                              title={exportFailureKey === `copy-pv-${i}` ? `Copy failed for ${pvLineText}` : `Copy this engine line as raw UCI moves: ${pvRawLine}`}
                              aria-label={copyPvLabel}
                              data-testid={`copy-engine-pv-${i}`}
                            >
                              {exportFailureKey === `copy-pv-${i}` ? <IconX /> : copiedPvIndex === i ? <IconCheck /> : <IconCopy />}
                              <span>{exportFailureKey === `copy-pv-${i}` ? 'Failed' : copiedPvIndex === i ? 'Copied' : 'Copy'}</span>
                            </button>
                            <button
                              type="button"
                              className="pv-action-btn"
                              onClick={() => handleKeepPvLine(pv.moves)}
                              disabled={!isReady || lineKept || !pv.moves.length || Boolean(gameResult) || isAiTurn || reviewStatus === 'running'}
                              title={lineKept ? 'This line and analysis are saved' : 'Keep the complete line and save this analysis snapshot without moving the board'}
                              aria-label={lineKept ? `Kept line ${i + 1} in the move tree` : lineExists ? `Update analysis for engine line ${i + 1}` : `Keep line ${i + 1} in the move tree`}
                              data-testid={`keep-engine-pv-${i}`}
                            >
                              {lineKept ? <IconCheck /> : <IconSave />}
                              <span>{lineKept ? 'Kept' : lineExists ? 'Update analysis' : 'Keep line'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                  {/* Diagnostics last: at 1280x720 the four cards stood between the
                      controls and the lines and left room for one line of three. The
                      lines are what the panel is for; the core, tier and node rate are
                      what you look at when something is wrong. */}
                  <div className="engine-dashboard" role="group" aria-label="Engine diagnostics">
                    <div className="engine-stat" title={engineCoreDetail} aria-label={engineCoreDetail}>
                      <span>Core</span>
                      <strong>{engineVariant}</strong>
                      <em>{engineBootConfig.threads}T · {engineBootConfig.hashMB}MB</em>
                    </div>
                    <div className="engine-stat">
                      <span>Profile</span>
                      <strong>{analysisEngineMode}</strong>
                      <em>{engineBootConfig.tier}{engineBootConfig.saferBoot ? ' · safe boot' : ''}</em>
                    </div>
                    <EngineSearchTelemetry store={telemetry} ready={isReady} queued={isSearchQueued} searching={isSearching} stalled={analysisIsStalled}
                      detail={engineRecoveryNotice ? `${engineRecoveryNotice.text}. ${engineRecoveryHint}` : analysisIsStalled ? describeAnalysisActivity(analysisActivity) : undefined}
                      label={engineRecoveryNotice?.text ?? (analysisIsStalled ? formatAnalysisActivity(analysisActivity) : undefined)}
                      secondary={engineRecoveryNotice ? engineRecoveryHint : candidateActive ? candidateSearch!.budgetLabel : analysisIsStalled ? 'tab in background' : undefined}
                    />
                    <div className="engine-stat">
                      <span>Detail</span>
                      <strong>{`MultiPV ${candidateActive ? candidateSearch!.moves.length : analysisMultiPv}`}</strong>
                      <em>{candidateActive ? 'Selected moves · WDL off' : analysisWdlEnabled ? 'WDL on' : 'WDL off'}</em>
                    </div>
                  </div>
                  {assistMode === 'pro' ? (
                    <EngineOutput store={telemetry} />
                  ) : candidateActive ? null : (
                    <div className="engine-coach-summary">
                      <div className="engine-coach-item">
                        <span>Best</span>
                        <strong>{coachBestMoveText}</strong>
                      </div>
                      <div className="engine-coach-item">
                        <span>Depth</span>
                        <strong>{!isReady ? '—' : topAnalysisPv?.depth ? `D${topAnalysisPv.depth}` : isSearchQueued ? 'Queued' : isSearching ? 'Pending' : `D${liveAnalysisPolicy.primary.depth}`}</strong>
                      </div>
                      <div className="engine-coach-item engine-coach-line">
                        <span>Line</span>
                        <strong>{coachLineText}</strong>
                      </div>
                    </div>
                  )}
                </>
  );
}
