const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const threads = (process.env.PIKAFISH_BROWSER_THREADS || '1,2,4').split(',').map(Number);
assert.ok(threads.length && threads.every(value => Number.isInteger(value) && value >= 1 && value <= 8), 'Thread counts must be integers from 1 to 8');
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  try {
    for (const threadCount of threads) {
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        // Keep verified engine assets between cases, but start every UI fixture
        // fresh. The dedicated engine searches startpos, independently of the
        // repeating 1024-ply study, to guarantee sustained real search work.
        await page.addInitScript(() => localStorage.clear());
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        await page.goto(base + '?moves=' + Array.from({ length: 1024 }, (_, i) => cycle[i % 4]).join('+'));
        await page.getByTestId('move-tree-active').waitFor();
        await page.addScriptTag({ url: new URL('pikafish.js', base).href });
        const startup = await page.evaluate(async ({ threadCount, base }) => {
          const started = performance.now();
          const engine = await window.Pikafish.createWorkerEngine({ basePath: new URL('.', base).href,
            variant: 'threaded-simd', threads: threadCount, hashMB: 64 });
          window.__busyEngine = engine; window.__lastSearchNodes = 0; window.__searchErrors = [];
          engine.addMessageListener(line => {
            const nodes = line.match(/\bnodes\s+(\d+)/); if (nodes) window.__lastSearchNodes = Number(nodes[1]);
            if (line.startsWith('[worker-error]')) window.__searchErrors.push(line);
          });
          await engine.uci(); await engine.isReady();
          engine.postMessage('position startpos'); engine.postMessage('go infinite');
          return { variant: engine.variant, readyMs: performance.now() - started };
        }, { threadCount, base });
        assert.equal(startup.variant, 'threaded-simd', 'Use a host with cross-origin isolation to compare thread counts');
        await page.waitForFunction(() => window.__lastSearchNodes > 0);
        const beforeNodes = await page.evaluate(() => window.__lastSearchNodes);
        const input = [], navigation = [];
        for (let index = 0; index < 30; index++) {
          const elapsed = await page.evaluate(() => new Promise((resolve, reject) => {
            const board = document.querySelector('.xiangqi-board'), selected = Boolean(board.querySelector('.piece.selected'));
            const observer = new MutationObserver(() => {
              if (Boolean(board.querySelector('.piece.selected')) === selected) return;
              observer.disconnect(); clearTimeout(timer);
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
            });
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Selection did not update')); }, 10_000);
            observer.observe(board, { attributes: true, childList: true, subtree: true });
            const started = performance.now(); board.querySelector('.hitbox[data-file="0"][data-rank="0"]').click();
          }));
          assert.equal(await page.locator('.piece.selected').count(), index % 2 === 0 ? 1 : 0);
          if (index >= 10) input.push(elapsed);
        }
        for (let index = 0; index < 30; index++) {
          const elapsed = await page.evaluate(() => new Promise((resolve, reject) => {
            const list = document.querySelector('.mtree-scroll'), before = list.querySelector('.mtree-chip-active').dataset.nodeId;
            const observer = new MutationObserver(() => {
              if (list.querySelector('.mtree-chip-active')?.dataset.nodeId === before) return;
              observer.disconnect(); clearTimeout(timer);
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
            });
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Navigation did not update')); }, 10_000);
            observer.observe(list, { attributes: true, childList: true, subtree: true });
            const button = [...document.querySelectorAll('button[aria-label="Go to previous move"]')].find(button => button.offsetParent !== null);
            const started = performance.now(); button.click();
          }));
          assert.equal(await page.getByTestId('move-tree-active').getAttribute('data-node-id'), 'n' + (1023 - index));
          if (index >= 10) navigation.push(elapsed);
        }
        const afterNodes = await page.evaluate(() => window.__lastSearchNodes);
        assert.ok(afterNodes > beforeNodes, 'Engine stopped doing work during input measurements');
        assert.deepEqual(await page.evaluate(() => window.__searchErrors), []);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ threads: threadCount, hashMB: 64, variant: startup.variant, plies: 1024, cpuThrottle: 4,
          samplesPerAction: input.length, engineReadyMs: Math.round(startup.readyMs), searchedNodesDuringInput: afterNodes - beforeNodes,
          medianSelectionToPaintMs: +percentile(input, .5).toFixed(1), p95SelectionToPaintMs: +percentile(input, .95).toFixed(1),
          medianNavigationToPaintMs: +percentile(navigation, .5).toFixed(1), p95NavigationToPaintMs: +percentile(navigation, .95).toFixed(1) }));
        await page.evaluate(async () => {
          const stopped = window.__busyEngine.waitForLine(/^bestmove/, { fresh: true, timeoutMs: 15_000 });
          window.__busyEngine.postMessage('stop'); await stopped; await window.__busyEngine.terminate();
        });
      } finally { await page.close(); }
    }
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
