const { spawn } = require('node:child_process');
const path = require('node:path');

// One repeatable entry point for the focused audit regressions, with an owned
// server so CI and local runs do not depend on another terminal or a fixed port.
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  try {
    await server.listen();
    const env = { ...process.env, XIANGQI_QA_URL: server.resolvedUrls.local[0] };
    for (const script of [
      'test-pgn-collection-browser.cjs',
      'test-pgn-notes-browser.cjs',
      'test-pgn-header-comments-browser.cjs',
      'test-pgn-glyphs-browser.cjs',
      'test-edit-glyphs-browser.cjs',
      'test-select-controls-browser.cjs',
      'test-study-notes-browser.cjs',
      'test-metadata-browser.cjs',
      'test-metadata-only-browser.cjs',
      'test-metadata-layout-browser.cjs',
      'test-snapshot-reuse-browser.cjs',
      'test-autosave-error-browser.cjs',
      'test-autosave-limit-browser.cjs',
      'test-explorer-browser.cjs',
      'test-library-matches-browser.cjs',
      'test-library-edit-focus-browser.cjs',
      'test-study-practice-browser.cjs',
      'test-update-study-browser.cjs',
      'test-beginner-browser.cjs',
      'test-rule-lessons-browser.cjs',
      'test-deferred-dialogs-browser.cjs',
      'test-deferred-review-browser.cjs',
      'test-graph-gaps-browser.cjs',
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
      'test-library-review-scope-browser.cjs',
      'test-mobile-tabs-text-browser.cjs',
      'test-recovery-text-browser.cjs',
      'test-game-over-text-browser.cjs',
      'test-dialog-initial-focus-browser.cjs',
      'test-xqf-details-browser.cjs',
      'test-xqf-capacity-browser.cjs',
      'test-library-annotations-browser.cjs',
      'test-dhtmlxq-browser.cjs',
      'test-root-notes-browser.cjs',
      'test-weights-cache-browser.cjs',
      'test-cloud-pv-browser.cjs',
      'test-cloud-response-browser.cjs',
      'test-search-queue-browser.cjs',
      'test-engine-position-browser.cjs',
      'test-engine-boot-race-browser.cjs',
      'test-worker-lifecycle-browser.cjs',
      'test-worker-progress-browser.cjs',
      'test-nnue-memory-browser.cjs',
      'test-engine-barriers-browser.cjs',
      'test-engine-startup-cancel-browser.cjs',
      'test-engine-recovery-navigation-browser.cjs',
      'test-engine-line-browser.cjs',
      'test-candidate-browser.cjs',
      'test-deep-result-browser.cjs',
      'test-search-telemetry-browser.cjs',
      'test-study-analysis-browser.cjs',
      'test-unicode-share-browser.cjs',
      'test-unicode-limits-browser.cjs',
      'test-study-undo-browser.cjs',
      'test-study-undo-edits-browser.cjs',
      'test-wdl-freshness-browser.cjs',
      'test-library-backup-browser.cjs',
      'test-audit-browser.cjs',
      'test-audit-followup-browser.cjs',
      'test-dialog-keyboard-browser.cjs',
    ]) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, script)], { env, stdio: 'inherit' });
        const timeout = setTimeout(() => { child.kill(); reject(new Error(`${script} timed out`)); }, 180_000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else reject(new Error(`${script} exited with ${code}`));
        });
      });
    }
  } finally { await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
