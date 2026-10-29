const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Built app, fresh contexts, alternating comparison order. Times describe this
// browser/machine and exclude engine startup/search; they are not CI thresholds.
(async () => {
  const urls = { current: process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/' };
  if (process.env.XIANGQI_QA_BASELINE_URL) urls.baseline = process.env.XIANGQI_QA_BASELINE_URL;
  const samples = Object.fromEntries(Object.keys(urls).map(name => [name, []]));
  const browser = await chromium.launch();
  try {
    for (let repeat = 0; repeat < 4; repeat++) {
      const names = Object.keys(urls);
      for (const name of repeat % 2 ? names.reverse() : names) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        try {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          await page.goto(urls[name] + '?moves=' + Array.from({ length: 1024 }, (_, i) => cycle[i % 4]).join('+'));
          await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n1024');
          for (let sample = 0; sample < 22; sample++) {
            const elapsed = await page.evaluate(() => new Promise((resolve, reject) => {
              const board = document.querySelector('.xiangqi-board');
              const before = Boolean(board.querySelector('.piece.selected'));
              let start;
              const timer = setTimeout(() => { observer.disconnect(); reject(new Error('No selected-piece update')); }, 10000);
              const observer = new MutationObserver(() => {
                if (Boolean(board.querySelector('.piece.selected')) === before) return;
                const elapsed = performance.now() - start;
                observer.disconnect(); clearTimeout(timer);
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(elapsed)));
              });
              observer.observe(board, { subtree: true, attributes: true, childList: true });
              start = performance.now();
              board.querySelector('.hitbox[data-file="0"][data-rank="0"]').click();
            }));
            assert.ok(Number.isFinite(elapsed));
            assert.equal(await page.locator('.piece.selected').count(), sample % 2 === 0 ? 1 : 0);
            if (sample >= 10) samples[name].push(elapsed);
          }
        } finally { await page.close(); }
      }
    }
    for (const [implementation, runs] of Object.entries(samples)) {
      runs.sort((a, b) => a - b);
      const percentile = fraction => runs[Math.floor((runs.length - 1) * fraction)];
      console.log(JSON.stringify({ implementation, action: 'piece select/deselect', plies: 1024, cpuThrottle: 4,
        samples: runs.length, medianClickToDomMs: percentile(.5), p90ClickToDomMs: percentile(.9) }));
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
