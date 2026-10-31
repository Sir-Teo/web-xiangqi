import { preview } from 'vite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 } });
const suites = process.argv.slice(2);
if (!suites.length) suites.push(
  'test-performance-budget-browser.cjs', 'test-board-interaction-browser.cjs', 'test-engine-assets-browser.cjs',
  'test-engine-telemetry-isolation-browser.cjs', 'test-warm-engine-browser.cjs',
  'test-virtual-moves-browser.cjs', 'test-move-render-browser.cjs',
  'test-analysis-move-render-browser.cjs', 'test-background-storage-browser.cjs',
  'test-study-snapshot-cache-browser.cjs', 'test-deep-storage-worker-browser.cjs',
);
try {
  for (const suite of suites) {
    console.log(`Checking ${suite}`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL(suite, import.meta.url))], {
        cwd: root, env: { ...process.env, XIANGQI_QA_URL: server.resolvedUrls.local[0] }, stdio: 'inherit', timeout: 240_000,
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${suite} failed: ${signal || code}`)));
    });
  }
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
