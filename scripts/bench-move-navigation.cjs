const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Run against a built app. Optionally compare an independently served baseline
// via XIANGQI_QA_BASELINE_URL; contexts alternate order to reduce warmup bias.
// Timings are observations, not correctness thresholds or physical-phone tests.
(async () => {
  const urls = { current: process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/' };
  if (process.env.XIANGQI_QA_BASELINE_URL) urls.baseline = process.env.XIANGQI_QA_BASELINE_URL;
  const browser = await chromium.launch();
  const samples = Object.fromEntries(Object.keys(urls).map(name => [name, []]));
  try {
    for (let repeat = 0; repeat < 4; repeat++) {
      const names = Object.keys(urls);
      for (const name of repeat % 2 ? names.reverse() : names) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        try {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
            window.Pikafish = function() {};
            window.Pikafish.createWorkerEngine = async () => {
              const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
              return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              } };
            };` }));
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          await page.goto(urls[name] + '?moves=' + Array.from({ length: 1024 }, (_, i) => cycle[i % 4]).join('+'));
          await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n1024');
          for (let sample = 0; sample < 22; sample++) {
            const result = await page.evaluate(() => new Promise((resolve, reject) => {
              const before = document.querySelector('[data-testid="move-tree-active"]').dataset.nodeId;
              const button = [...document.querySelectorAll('button[aria-label="Go to previous move"]')].find(node => node.offsetParent !== null);
              let start;
              const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Navigation did not update the move tree')); }, 10000);
              const observer = new MutationObserver(() => {
                const after = document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId;
                if (!after || after === before) return;
                const clickToDomMs = performance.now() - start;
                clearTimeout(timeout); observer.disconnect();
                requestAnimationFrame(() => requestAnimationFrame(() => resolve({ clickToDomMs, twoFramesMs: performance.now() - start, after })));
              });
              observer.observe(document.querySelector('.mtree-scroll'), { subtree: true, attributes: true, childList: true });
              start = performance.now(); button.click();
            }));
            assert.equal(result.after, 'n' + (1023 - sample));
            if (sample >= 10) samples[name].push(result);
          }
        } finally { await page.close(); }
      }
    }
    for (const [implementation, runs] of Object.entries(samples)) {
      const percentile = (key, fraction) => runs.map(run => run[key]).sort((a, b) => a - b)[Math.floor((runs.length - 1) * fraction)];
      console.log(JSON.stringify({ implementation, plies: 1024, cpuThrottle: 4, samples: runs.length,
        medianClickToDomMs: percentile('clickToDomMs', .5), p90ClickToDomMs: percentile('clickToDomMs', .9),
        medianTwoFramesMs: percentile('twoFramesMs', .5) }));
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
