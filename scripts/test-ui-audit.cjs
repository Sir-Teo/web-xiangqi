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
      'test-metadata-browser.cjs',
      'test-autosave-error-browser.cjs',
      'test-autosave-limit-browser.cjs',
      'test-explorer-browser.cjs',
      'test-library-matches-browser.cjs',
      'test-beginner-browser.cjs',
      'test-weights-cache-browser.cjs',
      'test-cloud-pv-browser.cjs',
      'test-search-queue-browser.cjs',
      'test-engine-position-browser.cjs',
      'test-engine-boot-race-browser.cjs',
      'test-worker-lifecycle-browser.cjs',
      'test-worker-progress-browser.cjs',
      'test-engine-startup-cancel-browser.cjs',
      'test-engine-recovery-navigation-browser.cjs',
      'test-engine-line-browser.cjs',
      'test-candidate-browser.cjs',
      'test-deep-result-browser.cjs',
      'test-unicode-share-browser.cjs',
      'test-study-undo-browser.cjs',
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
