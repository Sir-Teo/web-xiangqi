const { spawn } = require('node:child_process');
const path = require('node:path');
const { browserType } = require('./qa-browser.cjs');

// Exercise the same user workflows in each browser against the built app.
// An explicit browser override supports reproducing one failing matrix entry.
(async () => {
  const { preview } = await import('vite');
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  try {
    const browsers = process.env.XIANGQI_QA_BROWSER
      ? [browserType.name()] : ['chromium', 'webkit', 'firefox'];
    const failures = [];
    for (const browser of browsers) {
      for (const script of (process.argv.includes('--smoke') ? [
        'test-engine-on-demand-browser.cjs',
        'test-engine-startup-cancel-browser.cjs',
        'test-beginner-browser.cjs',
        'test-editor-keyboard-browser.cjs',
        'test-editor-pending-fen-browser.cjs',
        'test-board-coordinates-browser.cjs',
        'test-analysis-context-browser.cjs',
        'test-cloud-visibility-browser.cjs',
        'test-density-browser.cjs',
        'test-save-state-browser.cjs',
        'test-practice-notation-browser.cjs',
        'test-practice-progress-browser.cjs',
        'test-library-conflicts-browser.cjs',
        'test-library-salvage-browser.cjs',
        'test-library-concurrency-browser.cjs',
        'test-pgn-collection-browser.cjs',
      ] : [
        'test-worker-lifecycle-browser.cjs',
        'test-worker-progress-browser.cjs',
        'test-engine-progress-deadline-browser.cjs',
        'test-nnue-memory-browser.cjs',
        'test-engine-barriers-browser.cjs',
        'test-engine-startup-cancel-browser.cjs',
        'test-engine-recovery-navigation-browser.cjs',
        'test-beginner-browser.cjs',
        'test-play-startup-progress-browser.cjs',
        'test-rule-lessons-browser.cjs',
        'test-practice-available-sides-browser.cjs',
        'test-editor-keyboard-browser.cjs',
        'test-dialog-keyboard-browser.cjs',
        'test-palette-stationary-pointer-browser.cjs',
        'test-deferred-dialogs-browser.cjs',
        'test-deferred-review-browser.cjs',
        'test-unicode-share-browser.cjs',
        'test-unicode-limits-browser.cjs',
        'test-study-undo-browser.cjs',
        'test-study-undo-edits-browser.cjs',
        'test-library-undo-recovery-browser.cjs',
        'test-retained-game-download-browser.cjs',
        'test-library-pagination-browser.cjs',
        'test-undo-stack-browser.cjs',
        'test-notice-stack-browser.cjs',
        'test-save-error-retention-browser.cjs',
        'test-engine-line-browser.cjs',
        'test-candidate-browser.cjs',
        'test-deep-result-browser.cjs',
        'test-search-telemetry-browser.cjs',
        'test-pv-standing-browser.cjs',
        'test-study-analysis-browser.cjs',
        'test-library-analysis-search-browser.cjs',
        'test-library-move-search-browser.cjs',
        'test-library-match-disclosures-browser.cjs',
        'test-study-load-context-browser.cjs',
        'test-dense-pgn-backup-browser.cjs',
        'test-study-breadth-browser.cjs',
        'test-analysis-bounds-browser.cjs',
        'test-review-bounds-browser.cjs',
        'test-eval-storage-bounds-browser.cjs',
        'test-drill-bounds-browser.cjs',
        'test-pgn-notes-browser.cjs',
        'test-pgn-header-comments-browser.cjs',
        'test-pgn-glyphs-browser.cjs',
        'test-edit-glyphs-browser.cjs',
        'test-select-controls-browser.cjs',
        'test-engine-resource-settings-browser.cjs',
        'test-review-engine-restart-browser.cjs',
        'test-hint-restart-browser.cjs',
        'test-hint-unavailable-browser.cjs',
        'test-mobile-hint-feedback-browser.cjs',
        'test-position-card-text-browser.cjs',
        'test-study-notes-browser.cjs',
        'test-ai-pause-notes-browser.cjs',
        'test-cloud-response-browser.cjs',
        'test-pgn-collection-browser.cjs',
        'test-transfer-cancellation-browser.cjs',
        'test-collection-evals-browser.cjs',
        'test-eval-kind-browser.cjs',
        'test-graph-gaps-browser.cjs',
        'test-graph-reuse-browser.cjs',
        'test-graph-visibility-browser.cjs',
        'test-move-tree-visibility-browser.cjs',
        'test-graph-details-browser.cjs',
        'test-graph-bounds-browser.cjs',
        'test-graph-axis-browser.cjs',
        'test-move-quality-browser.cjs',
        'test-board-render-browser.cjs',
        'test-move-render-browser.cjs',
        'test-move-list-reflow-browser.cjs',
        'test-analysis-move-render-browser.cjs',
        'test-variation-focus-browser.cjs',
        'test-active-continuation-browser.cjs',
        'test-study-main-line-browser.cjs',
        'test-loaded-result-browser.cjs',
        'test-recorded-result-browser.cjs',
        'test-library-primary-line-browser.cjs',
        'test-pgn-result-endpoint-browser.cjs',
        'test-library-primary-cache-browser.cjs',
        'test-library-dates-browser.cjs',
        'test-library-details-browser.cjs',
        'test-library-review-scope-browser.cjs',
        'test-library-edit-focus-browser.cjs',
        'test-library-action-focus-browser.cjs',
        'test-study-practice-browser.cjs',
        'test-update-study-browser.cjs',
        'test-metadata-only-browser.cjs',
        'test-metadata-layout-browser.cjs',
        'test-snapshot-reuse-browser.cjs',
        'test-repetition-cache-browser.cjs',
        'test-halfmove-clock-browser.cjs',
        'test-rule60-clock-browser.cjs',
        'test-mobile-tabs-text-browser.cjs',
        'test-recovery-text-browser.cjs',
        'test-game-over-text-browser.cjs',
        'test-dialog-initial-focus-browser.cjs',
        'test-xqf-details-browser.cjs',
        'test-xqf-capacity-browser.cjs',
        'test-library-annotations-browser.cjs',
        'test-dhtmlxq-browser.cjs',
        'test-root-notes-browser.cjs',
        'test-library-worker-browser.cjs',
        'test-library-visibility-browser.cjs',
        'test-library-lookup-browser.cjs',
        'test-library-retry-browser.cjs',
        'test-explorer-browser.cjs',
        'test-autosave-limit-browser.cjs',
      ])) {
        console.log(`[${browser}] ${script}`);
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [path.join(__dirname, script)], {
            env: { ...process.env, XIANGQI_QA_URL: server.resolvedUrls.local[0], XIANGQI_QA_BROWSER: browser },
            stdio: 'inherit',
          });
          const timer = setTimeout(() => { child.kill(); reject(new Error(`${browser}: ${script} timed out`)); }, 180_000);
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.once('exit', code => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`${browser}: ${script} exited with ${code}`));
          });
        }).catch(error => { failures.push(error.message); console.error(error.message); });
      }
    }
    if (failures.length) throw new Error(`Cross-browser failures:\n${failures.join('\n')}`);
  } finally { await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
})().catch(error => { console.error(error); process.exitCode = 1; });
