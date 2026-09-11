const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ')) queueMicrotask(() => {
                if (window.__liveScore) emit('info depth 12 multipv 1 score cp 75 pv h0g2');
                emit('bestmove ' + (window.__liveScore ? 'h0g2' : '(none)'));
              });
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        const graph = async label => {
          if (width < 900) await page.getByTestId('mobile-view-analysis').click();
          const tab = page.getByTestId(width < 900 ? 'mobile-analysis-tab-graph' : 'left-panel-tab-graph');
          await tab.click();
          await page.waitForFunction(label => document.querySelector('.graph-legend strong')?.textContent === label, label);
          await page.getByTestId('graph-load-sweep').waitFor({ state: 'hidden' });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.evaluate(async () => { await Promise.all((document.querySelector('.mobile-analysis-tabs')?.getAnimations({ subtree: true }) ?? []).map(animation => animation.finished.catch(() => {}))); });
        };
        const selectMove = async move => { await page.keyboard.press('t'); await page.locator('.mtree-chip').filter({ hasText: move }).click(); };
        const navigator = page.getByRole('slider', { name: 'Evaluation graph move navigator' });
        await page.goto(base); await graph('Not evaluated');
        assert.equal(await page.locator('.graph-line').getAttribute('d'), '');
        assert.equal(await page.locator('.graph-extrema').innerText(), 'Peak Red n/a\nPeak Black n/a');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('h2e2 {[%eval 4.00]} h9g7 b0c2 {[%eval 0.00]} b9c7 {[%eval -5.00]} *');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await selectMove('h9g7'); await graph('Not evaluated');
        assert.match(await navigator.getAttribute('aria-valuetext'), /ply 2, Not evaluated/);
        const path = await page.locator('.graph-line').getAttribute('d');
        assert.equal((path.match(/M /g) || []).length, 2);
        assert.equal((path.match(/L /g) || []).length, 1);
        assert.equal(await page.locator('.graph-point-unknown').count(), 2, 'Root and unscored move should have open markers');
        await navigator.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('.graph-legend strong')?.textContent === 'Red POV 0.00');
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() => document.querySelector('.graph-legend strong')?.textContent === 'Not evaluated');
        await page.keyboard.press('Home');
        await page.waitForFunction(() => document.querySelector('[data-testid="graph-current-point"]')?.textContent === 'Start Position');
        assert.match(await navigator.getAttribute('aria-valuetext'), /Start position, Not evaluated/);
        await selectMove('h9g7'); await graph('Not evaluated');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-graph-gaps-${browserType.name()}-${width}.png` });

        // Filling this one gap must not fabricate a root score.
        await page.evaluate(() => { window.__liveScore = true; });
        await page.keyboard.press('e'); await page.getByTestId('deep-dive-btn').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-pv-score-0"] strong')?.textContent === '+0.8');
        await graph('Red POV +0.75');
        assert.equal(await page.locator('.graph-point-unknown').count(), 1);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: unknown root/moves, graph gaps, true zero, keyboard navigation and live gap filling passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
