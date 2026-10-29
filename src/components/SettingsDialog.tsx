import { useRef } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { GAME_MODES, type GameMode } from '../utils/gameModes';
import type { AnalysisEngineMode, AssistMode } from '../utils/preferences';
import type { EngineBootConfig } from '../utils/analysisProfile';
import type { AiSpeed } from './Controls/WatchControls';
import type { BoardOrientation } from './Board/Board';
import { PIECE_STYLES, PIECE_STYLE_DESCRIPTIONS, PIECE_STYLE_LABELS, type PieceStyle } from '../utils/pieceStyle';
import { NOTATION_STYLES, NOTATION_STYLE_DESCRIPTIONS, NOTATION_STYLE_LABELS, type XiangqiNotationStyle } from '../utils/xiangqiNotation';
import { writeStorage } from '../utils/storage';
import { BEGINNER_GUIDE_STORAGE_KEY } from '../utils/storageKeys';
import { IconX, IconCheck, IconLink, IconRefresh } from './icons';

const ANALYSIS_ENGINE_MODE_COPY: Record<AnalysisEngineMode, { ariaLabel: string; title: string }> = {
  stable: {
    ariaLabel: 'Stable analysis engine profile, safer boot and conservative resources',
    title: 'Stable profile: safer boot and conservative engine resources.',
  },
  optimized: {
    ariaLabel: 'Optimized analysis engine profile, faster search when supported',
    title: 'Optimized profile: faster search when this device supports it.',
  },
};
const ASSIST_MODE_COPY: Record<AssistMode, { ariaLabel: string; title: string }> = {
  coach: {
    ariaLabel: 'Coach interface, show rule hints and guided move context',
    title: 'Coach interface: show rule hints and guided move context.',
  },
  pro: {
    ariaLabel: 'Pro interface, compact analysis with fewer teaching prompts',
    title: 'Pro interface: compact analysis with fewer teaching prompts.',
  },
};
const THIRD_PARTY_NOTICES_HREF = `${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`;

export interface SettingsDialogProps {
  closeSettings: () => void;
  workspaceMode: 'play' | 'analysis';
  startEngineAnalysis: () => void;
  setWorkspaceMode: (mode: 'play' | 'analysis') => void;
  assistMode: AssistMode;
  setAssistMode: (mode: AssistMode) => void;
  guideDismissed: boolean;
  setGuideDismissed: (dismissed: boolean) => void;
  notationStyle: XiangqiNotationStyle;
  setNotationStyle: (style: XiangqiNotationStyle) => void;
  pieceStyle: PieceStyle;
  setPieceStyle: (style: PieceStyle) => void;
  gameMode: GameMode;
  applyMode: (mode: GameMode) => void;
  orientation: BoardOrientation;
  setOrientation: (orientation: BoardOrientation) => void;
  uiDensity: 'comfortable' | 'compact';
  setUiDensity: (density: 'comfortable' | 'compact') => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  analysisEngineMode: AnalysisEngineMode;
  setAnalysisEngineMode: (mode: AnalysisEngineMode) => void;
  searchDepth: number;
  setSearchDepth: (depth: number) => void;
  liveAnalysisDepth: number;
  engineThreadChoices: readonly number[];
  engineHashChoices: readonly number[];
  engineBootConfig: Pick<EngineBootConfig, 'threads' | 'hashMB'>;
  setEngineThreads: (threads: number | undefined) => void;
  setEngineHashMB: (hashMB: number | undefined) => void;
  aiSpeed: AiSpeed;
  handleSpeedChange: (speed: AiSpeed) => void;
  soundEnabled: boolean;
  handleSoundToggle: (enabled: boolean) => void;
  resetPreferences: () => void;
  resetGame: () => void;
}

export function SettingsDialog({
  closeSettings,
  workspaceMode,
  startEngineAnalysis,
  setWorkspaceMode,
  assistMode,
  setAssistMode,
  guideDismissed,
  setGuideDismissed,
  notationStyle,
  setNotationStyle,
  pieceStyle,
  setPieceStyle,
  gameMode,
  applyMode,
  orientation,
  setOrientation,
  uiDensity,
  setUiDensity,
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
  analysisEngineMode,
  setAnalysisEngineMode,
  searchDepth,
  setSearchDepth,
  liveAnalysisDepth,
  engineThreadChoices,
  engineHashChoices,
  engineBootConfig,
  setEngineThreads,
  setEngineHashMB,
  aiSpeed,
  handleSpeedChange,
  soundEnabled,
  handleSoundToggle,
  resetPreferences,
  resetGame
}: SettingsDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog);
  return (
    <>
      <div
        className="settings-backdrop"
        onClick={closeSettings}
        aria-hidden="true"
      />
      <div
        className="settings-body"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        id="settings-dialog"
        data-testid="settings-dialog"
        ref={dialog}
        tabIndex={-1}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button
            className="settings-close-btn"
            type="button"
            onClick={closeSettings}
            aria-label="Close settings"
          >
            <IconX />
          </button>
        </div>

        <div className="settings-group">
          <label htmlFor="settings-workspace-mode">Workspace</label>
          <select
            id="settings-workspace-mode"
            className="premium-select app-select"
            value={workspaceMode}
            onChange={(e) => e.target.value === 'analysis' ? startEngineAnalysis() : setWorkspaceMode('play')}
          >
            <option value="analysis">Analysis</option>
            <option value="play">Play</option>
          </select>
        </div>

        <div className="settings-group">
          <span id="settings-interface-label" className="settings-label">Interface</span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-interface-label">
            <button
              type="button"
              className={`pill-btn ${assistMode === 'coach' ? 'pill-btn-active' : ''}`}
              onClick={() => setAssistMode('coach')}
              aria-pressed={assistMode === 'coach'}
              aria-label={ASSIST_MODE_COPY.coach.ariaLabel}
              title={ASSIST_MODE_COPY.coach.title}
            >
              Coach
            </button>
            <button
              type="button"
              className={`pill-btn ${assistMode === 'pro' ? 'pill-btn-active' : ''}`}
              onClick={() => setAssistMode('pro')}
              aria-pressed={assistMode === 'pro'}
              aria-label={ASSIST_MODE_COPY.pro.ariaLabel}
              title={ASSIST_MODE_COPY.pro.title}
            >
              Pro
            </button>
          </div>
          {/* The same visible hint Move Notation has. These two groups are
              the ones whose labels do not explain themselves -- "Coach" and
              "Optimized" mean nothing until told -- and the telling lived
              only in `title`, which does not exist on a touch screen. The
              words are the ones already written for the tooltip. */}
          <p className="settings-hint">{ASSIST_MODE_COPY[assistMode].title}</p>
          <button type="button" className={`chip-btn settings-guide-toggle ${!guideDismissed ? 'chip-btn-primary' : ''}`}
            aria-pressed={!guideDismissed}
            aria-describedby="settings-guide-hint"
            onClick={() => {
              const dismissed = !guideDismissed;
              setGuideDismissed(dismissed);
              writeStorage(BEGINNER_GUIDE_STORAGE_KEY, String(dismissed));
            }}>
            {!guideDismissed && <IconCheck aria-hidden="true" focusable="false" />}
            First-move guide
          </button>
          <p className="settings-hint" id="settings-guide-hint">Appears on empty local boards in Coach mode.</p>
        </div>

        <div className="settings-group">
          <span id="settings-notation-label" className="settings-label">Move Notation</span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-notation-label">
            {NOTATION_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                className={`pill-btn ${notationStyle === style ? 'pill-btn-active' : ''}`}
                onClick={() => setNotationStyle(style)}
                aria-pressed={notationStyle === style}
                aria-label={`Write moves in ${NOTATION_STYLE_LABELS[style]} notation. ${NOTATION_STYLE_DESCRIPTIONS[style]}`}
                title={NOTATION_STYLE_DESCRIPTIONS[style]}
                data-testid={`notation-style-${style}`}
              >
                {NOTATION_STYLE_LABELS[style]}
              </button>
            ))}
          </div>
          <p className="settings-hint">{NOTATION_STYLE_DESCRIPTIONS[notationStyle]}</p>
        </div>

        <div className="settings-group">
          <span id="settings-piece-style-label" className="settings-label">Pieces</span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-piece-style-label">
            {PIECE_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                className={`pill-btn ${pieceStyle === style ? 'pill-btn-active' : ''}`}
                onClick={() => setPieceStyle(style)}
                aria-pressed={pieceStyle === style}
                aria-label={`${PIECE_STYLE_LABELS[style]}: Draw the pieces as ${style === 'letters' ? 'WXF letters' : 'traditional characters'}. ${PIECE_STYLE_DESCRIPTIONS[style]}`}
                title={PIECE_STYLE_DESCRIPTIONS[style]}
                data-testid={`piece-style-${style}`}
              >
                {PIECE_STYLE_LABELS[style]}
              </button>
            ))}
          </div>
          <p className="settings-hint">{PIECE_STYLE_DESCRIPTIONS[pieceStyle]}</p>
        </div>

        <div className="settings-group">
          <label htmlFor="settings-game-mode">Game Mode</label>
          <select
            id="settings-game-mode"
            className="premium-select app-select"
            value={gameMode}
            onChange={(e) => {
              applyMode(e.target.value as GameMode);
              closeSettings();
            }}
          >
            {GAME_MODES.map(({ mode, label }) => (
              <option key={mode} value={mode}>{label}</option>
            ))}
          </select>
        </div>

        <div className="settings-group">
          <span id="settings-orientation-label" className="settings-label">Board Orientation</span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-orientation-label">
            <button
              type="button"
              className={`pill-btn ${orientation === 'red' ? 'pill-btn-active' : ''}`}
              onClick={() => setOrientation('red')}
              aria-pressed={orientation === 'red'}
            >
              Red at bottom
            </button>
            <button
              type="button"
              className={`pill-btn ${orientation === 'black' ? 'pill-btn-active' : ''}`}
              onClick={() => setOrientation('black')}
              aria-pressed={orientation === 'black'}
            >
              Black at bottom
            </button>
          </div>
        </div>

        <div className="settings-group">
          <label htmlFor="settings-ui-density">Interface density</label>
          <select id="settings-ui-density" className="premium-select app-select" value={uiDensity}
            onChange={event => setUiDensity(event.target.value as 'comfortable' | 'compact')}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
          <p className="settings-hint">Comfortable enlarges panel text and controls while keeping the board size.</p>
        </div>

        <div className="settings-group">
          <span id="settings-layout-label" className="settings-label">Layout</span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-layout-label">
            <button
              type="button"
              className={`pill-btn ${leftPanelOpen ? 'pill-btn-active' : ''}`}
              onClick={onToggleLeftPanel}
              aria-pressed={leftPanelOpen}
            >
              Graph Panel
            </button>
            <button
              type="button"
              className={`pill-btn ${rightPanelOpen ? 'pill-btn-active' : ''}`}
              onClick={onToggleRightPanel}
              aria-pressed={rightPanelOpen}
            >
              Tree Panel
            </button>
          </div>
        </div>

        <details className="engine-advanced settings-engine-advanced" data-testid="advanced-engine-settings">
          <summary>Advanced engine settings</summary>
          <p className="settings-hint">Tune search depth, CPU and memory. Device defaults work without adjustment.</p>
        <div className="settings-group">
          <span id="settings-analysis-engine-label" className="settings-label">Analysis Engine</span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-analysis-engine-label">
            <button
              type="button"
              className={`pill-btn ${analysisEngineMode === 'stable' ? 'pill-btn-active' : ''}`}
              onClick={() => setAnalysisEngineMode('stable')}
              aria-pressed={analysisEngineMode === 'stable'}
              aria-label={ANALYSIS_ENGINE_MODE_COPY.stable.ariaLabel}
              title={ANALYSIS_ENGINE_MODE_COPY.stable.title}
            >
              Stable
            </button>
            <button
              type="button"
              className={`pill-btn ${analysisEngineMode === 'optimized' ? 'pill-btn-active' : ''}`}
              onClick={() => setAnalysisEngineMode('optimized')}
              aria-pressed={analysisEngineMode === 'optimized'}
              aria-label={ANALYSIS_ENGINE_MODE_COPY.optimized.ariaLabel}
              title={ANALYSIS_ENGINE_MODE_COPY.optimized.title}
            >
              Optimized
            </button>
          </div>
          <p className="settings-hint">{ANALYSIS_ENGINE_MODE_COPY[analysisEngineMode].title}</p>
        </div>

        <div className="settings-group">
          {/* Every other group here is a one- or two-word label. Spelling the
              scope out inline pushed this one onto a second line and orphaned
              its value; it lives in the tooltip instead. */}
          <label
            htmlFor="settings-search-depth"
            className="settings-label-value"
            title="Caps live analysis; the AI opponent has its own ceiling per strength"
          >
            <span>Search Depth</span>
            <strong>
              {searchDepth}
              {liveAnalysisDepth < searchDepth
                ? ` · this device ${liveAnalysisDepth}`
                : ''}
            </strong>
          </label>
          <input
            id="settings-search-depth"
            type="range"
            min="1"
            max="24"
            value={searchDepth}
            onChange={(e) => setSearchDepth(Number(e.target.value))}
            className="premium-slider"
          />
        </div>

        {/* The transposition table is the one engine resource a strong
            player expects to set, and it matters more now that a search
            runs for a second or two: a table that fills mid-search starts
            discarding work the search is about to want again. `hash %` in
            the engine dashboard is what says the current size is too small.
            Changing it reboots the engine, which takes about a third of a
            second, so the label says so rather than leaving a stall
            unexplained. */}
        {/* Downward only, and the ladder says so by stopping at what this
            machine was going to take anyway. The reason to want it is an
            unplugged laptop or a machine busy with something that matters
            more than the search; upward has nothing to offer, because the
            ceiling is the shipped core's thread pool rather than a policy. */}
        {engineThreadChoices.length > 1 ? (
          <div className="settings-group">
            <span
              id="settings-engine-threads-label"
              className="settings-label"
              title="How much of the processor the search gets. Changing it restarts the engine."
            >
              Engine Threads
            </span>
            <div className="settings-inline-toggles" role="group" aria-labelledby="settings-engine-threads-label" aria-describedby="settings-engine-threads-help">
              {engineThreadChoices.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`pill-btn ${engineBootConfig.threads === count ? 'pill-btn-active' : ''}`}
                  onClick={() => setEngineThreads(count)}
                  aria-pressed={engineBootConfig.threads === count}
                  aria-label={`Engine threads ${count}`}
                >
                  {count}
                </button>
              ))}
            </div>
            <p id="settings-engine-threads-help" className="settings-help">
              Fewer threads leave more CPU available for other apps. More threads can speed up analysis.
            </p>
          </div>
        ) : null}

        <div className="settings-group">
          <span
            id="settings-engine-hash-label"
            className="settings-label"
            title="The engine's transposition table. Changing it restarts the engine."
          >
            Engine Hash
          </span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-engine-hash-label" aria-describedby="settings-engine-hash-help">
            {engineHashChoices.map((size) => (
              <button
                key={size}
                type="button"
                className={`pill-btn ${engineBootConfig.hashMB === size ? 'pill-btn-active' : ''}`}
                onClick={() => setEngineHashMB(size)}
                aria-pressed={engineBootConfig.hashMB === size}
                aria-label={`Engine hash ${size} megabytes`}
              >
                {size}MB
              </button>
            ))}
          </div>
          <p id="settings-engine-hash-help" className="settings-help">
            Hash remembers positions already searched. A larger hash can help longer analysis, but uses more memory.
          </p>
        </div>

        <div className="settings-group">
          <button
            type="button"
            className="pill-btn settings-resource-reset"
            aria-describedby="settings-engine-defaults-help"
            onClick={() => { setEngineThreads(undefined); setEngineHashMB(undefined); }}
          >
            Use device defaults
          </button>
          <p id="settings-engine-defaults-help" className="settings-help">
            Restore automatic thread and hash choices for this device. Changing resources restarts the engine.
          </p>
        </div>

        </details>

        {gameMode !== 'PvP' && (
          <div className="settings-group">
            <span id="settings-ai-speed-label" className="settings-label">AI Speed</span>
            <div className="settings-inline-toggles" role="group" aria-labelledby="settings-ai-speed-label">
              {(['slow', 'normal', 'fast', 'step'] as AiSpeed[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`pill-btn ${aiSpeed === s ? 'pill-btn-active' : ''}`}
                  onClick={() => handleSpeedChange(s)}
                  aria-pressed={aiSpeed === s}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="settings-group">
          <span id="settings-sound-label" className="settings-label">Sound Effects</span>
          <div className="settings-inline-toggles" role="group" aria-labelledby="settings-sound-label">
            <button
              type="button"
              className={`pill-btn ${soundEnabled ? 'pill-btn-active' : ''}`}
              onClick={() => handleSoundToggle(true)}
              aria-pressed={soundEnabled}
            >
              On
            </button>
            <button
              type="button"
              className={`pill-btn ${!soundEnabled ? 'pill-btn-active' : ''}`}
              onClick={() => handleSoundToggle(false)}
              aria-pressed={!soundEnabled}
            >
              Off
            </button>
          </div>
        </div>

        <div className="settings-group">
          <a
            className="settings-link"
            href={THIRD_PARTY_NOTICES_HREF}
            target="_blank"
            rel="noreferrer noopener"
          >
            <IconLink /> Engine Notices
          </a>
          <button
            type="button"
            className="gc-btn settings-reset-btn"
            onClick={resetPreferences}
            data-testid="reset-preferences-btn"
          >
            <IconRefresh /> Reset Preferences
          </button>
          <button
            type="button"
            className="gc-btn gc-btn-danger"
            onClick={() => { resetGame(); closeSettings(); }}
          >
            <IconRefresh /> New Game
          </button>
        </div>
      </div>
    </>
  );
}
