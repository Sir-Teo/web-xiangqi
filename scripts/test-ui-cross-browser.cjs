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
      for (const script of [
        'test-worker-lifecycle-browser.cjs',
        'test-worker-progress-browser.cjs',
        'test-engine-startup-cancel-browser.cjs',
        'test-engine-recovery-navigation-browser.cjs',
        'test-beginner-browser.cjs',
        'test-rule-lessons-browser.cjs',
        'test-editor-keyboard-browser.cjs',
        'test-unicode-share-browser.cjs',
        'test-study-undo-browser.cjs',
        'test-engine-line-browser.cjs',
        'test-candidate-browser.cjs',
        'test-deep-result-browser.cjs',
        'test-pv-standing-browser.cjs',
        'test-study-analysis-browser.cjs',
        'test-pgn-notes-browser.cjs',
        'test-pgn-collection-browser.cjs',
        'test-collection-evals-browser.cjs',
        'test-eval-kind-browser.cjs',
        'test-graph-gaps-browser.cjs',
        'test-board-render-browser.cjs',
        'test-library-worker-browser.cjs',
        'test-explorer-browser.cjs',
        'test-autosave-limit-browser.cjs',
      ]) {
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
