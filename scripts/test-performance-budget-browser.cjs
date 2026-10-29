const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) for (const plies of [0, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__interactionTasks = [];
        new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__interactionTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true });
        const observer = new MutationObserver(() => {
          if (document.querySelectorAll('.xiangqi-board .hitbox').length !== 90) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => { window.__boardUsableMs = performance.now(); }));
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
      await page.goto(base + (plies ? '?moves=' + Array.from({ length: plies }, (_, i) => cycle[i % 4]).join('+') : ''));
      await page.waitForFunction(() => Number.isFinite(window.__boardUsableMs));
      const usable = await page.evaluate(() => window.__boardUsableMs);
      assert.ok(usable < (plies ? 3000 : 1500), `${width}px/${plies} plies board usable: ${usable.toFixed(0)}ms`);
      const samples = [];
      let heapBefore, started;
      for (let index = 0; index < 50; index++) {
        if (index === 10) {
          await cdp.send('HeapProfiler.collectGarbage');
          heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
          started = await page.evaluate(() => performance.now());
        }
        const elapsed = await page.evaluate(() => new Promise((resolve, reject) => {
          const board = document.querySelector('.xiangqi-board'), previous = Boolean(board.querySelector('.piece.selected'));
          const timer = setTimeout(() => { observer.disconnect(); reject(new Error('No visible input response')); }, 5000);
          const observer = new MutationObserver(() => {
            if (Boolean(board.querySelector('.piece.selected')) === previous) return;
            observer.disconnect(); clearTimeout(timer);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
          });
          observer.observe(board, { attributes: true, subtree: true, childList: true });
          const start = performance.now();
          board.querySelector('.hitbox[data-file="0"][data-rank="0"]').click();
        }));
        assert.equal(await page.locator('.piece.selected').count(), index % 2 === 0 ? 1 : 0);
        if (index >= 10) samples.push(elapsed);
      }
      const navigation = [];
      if (plies) for (let index = 0; index < 30; index++) {
        const elapsed = await page.evaluate(() => new Promise((resolve, reject) => {
          const fen = document.querySelector('.bottombar-fen');
          const before = fen.getAttribute('title');
          const button = [...document.querySelectorAll('button[aria-label="Go to previous move"]')].find(button => button.offsetParent !== null);
          const timer = setTimeout(() => { observer.disconnect(); reject(new Error('No navigation response')); }, 5000);
          const observer = new MutationObserver(() => {
            const after = fen.getAttribute('title');
            if (!after || after === before) return;
            clearTimeout(timer); observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
          });
          observer.observe(document.body, { attributes: true, subtree: true, childList: true });
          const start = performance.now(); button.click();
        }));
        assert.match(await page.locator('.wc-meta').innerText(), new RegExp(`${plies - index - 1}\\s*/\\s*${plies}`));
        if (index >= 10) navigation.push(elapsed);
      }
      const finished = await page.evaluate(() => performance.now());
      await cdp.send('HeapProfiler.collectGarbage');
      const heapGrowth = (await cdp.send('Runtime.getHeapUsage')).usedSize - heapBefore;
      const tasks = await page.evaluate(({ started, finished }) => window.__interactionTasks.filter(entry => entry.start >= started && entry.start <= finished).map(entry => entry.duration), { started, finished });
      const p95 = percentile(samples, .95), longest = Math.max(0, ...tasks);
      assert.ok(p95 < 100, `Input-to-paint p95 ${p95.toFixed(1)}ms exceeds 100ms`);
      if (navigation.length) assert.ok(percentile(navigation, .95) < 100, `Navigation-to-paint p95 ${percentile(navigation, .95).toFixed(1)}ms exceeds 100ms`);
      assert.ok(longest < 100, `Interaction main-thread task ${longest.toFixed(1)}ms exceeds 100ms`);
      assert.ok(heapGrowth < 8 * 1024 * 1024, `Repeated input retained ${(heapGrowth / 1024 / 1024).toFixed(1)}MB`);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, plies, cpuThrottle: 4, boardUsableMs: Math.round(usable), samples: samples.length,
        medianInputToPaintMs: +percentile(samples, .5).toFixed(1), p95InputToPaintMs: +p95.toFixed(1),
        ...(navigation.length ? { p95NavigationToPaintMs: +percentile(navigation, .95).toFixed(1) } : {}),
        longestInteractionTaskMs: longest, retainedHeapGrowthBytes: heapGrowth }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
