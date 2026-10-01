const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [320, 900], [844, 390]]) for (const black of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__wire = 'cp 150 lowerbound';
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            let position = '', depth = 12; const listeners = [];
            const emit = line => listeners.forEach(fn => fn(line));
            const move = () => position.split(' moves ')[1]?.split(' ').length % 2 ? 'i9i8' : 'i0i1';
            window.__emitScore = wire => { window.__wire = wire; if (wire) emit('info depth ' + (++depth) + ' multipv 1 score ' + wire + ' pv ' + move()); };
            window.__complete = () => emit('bestmove ' + move());
            return { variant: 'single-simd', addMessageListener: fn => listeners.push(fn), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('position ')) position = command;
              if (command.startsWith('go ')) queueMicrotask(() => window.__emitScore(window.__wire));
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };`
        }));
        await page.goto(base + '?moves=' + (black ? 'h2e2' : 'h2e2+h9g7'));
        await page.getByTestId('start-engine-analysis').click();
        await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Evaluation graph');
        const graph = page.locator('.graph-wrap');
        const navigator = page.getByRole('slider', { name: 'Evaluation graph move navigator' });
        await navigator.waitFor();
        // Details appear only while the graph is active (8cb0862); focus keeps
        // them up for the whole check, as the layout suite does.
        await page.locator('.winrate-graph').focus();
        for (const [wire, label, direction] of [
          ['cp 150 lowerbound', black ? '-1.50' : '+1.50', black ? 'Upper' : 'Lower'],
          ['cp 150 upperbound', black ? '-1.50' : '+1.50', black ? 'Lower' : 'Upper'],
          ['mate 3 lowerbound', black ? '-M3' : '+M3', black ? 'Upper' : 'Lower'],
        ]) {
          await page.evaluate(wire => window.__emitScore(wire), wire);
          const explanation = `${direction} bound, not an exact score`;
          await page.waitForFunction(explanation => document.querySelector('.winrate-graph')?.getAttribute('aria-valuetext')?.includes(explanation), explanation);
          assert.equal(await graph.locator('.graph-legend strong').innerText(), `Red POV ${label} · Bound`);
          assert.match(await graph.locator('.graph-tooltip').innerText(), new RegExp(explanation));
          assert.equal(await graph.locator('.graph-point-bound').count(), 1);
          assert.equal(await graph.locator('.graph-summary-card').nth(2).locator('strong').innerText(), 'n/a', 'An uncertain score must not define the game swing');
          assert.equal(await graph.locator('.graph-extrema').innerText(), 'Peak Red n/a\nPeak Black n/a');
          assert.equal(await graph.getByTestId('graph-bound-note').innerText(), 'Peaks and swing use exact scores.');
          for (const fontSize of ['16px', '32px', '16px']) {
            await page.evaluate(size => { document.documentElement.style.fontSize = size; }, fontSize);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal(await graph.evaluate(node => [...node.querySelectorAll('.graph-summary-card, .graph-legend strong, .graph-tooltip, .graph-bound-note')].some(el => el.scrollWidth > el.clientWidth + 1)), false, 'Graph uncertainty labels must fit with enlarged text');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            if (fontSize === '32px' && wire === 'cp 150 lowerbound') {
              await page.setViewportSize({ width, height: 1800 });
              await graph.scrollIntoViewIfNeeded();
              await graph.screenshot({ path: `/tmp/xiangqi-graph-bound-${browserType.name()}-${width}x${height}-${black ? 'black' : 'red'}.png` });
              await page.setViewportSize({ width, height });
            }
          }
        }
        const exactLabel = black ? '-1.50' : '+1.50';
        await page.evaluate(() => window.__emitScore('cp 150'));
        await page.waitForFunction(label => document.querySelector('.graph-legend strong')?.textContent === `Red POV ${label}`, exactLabel);
        assert.equal(await graph.locator('.graph-point-bound').count(), 0);
        assert.equal(await graph.getByTestId('graph-bound-note').count(), 0);
        assert.doesNotMatch(await navigator.getAttribute('aria-valuetext'), /bound/);
        assert.equal(await graph.locator('.graph-summary-card').nth(2).locator('strong').innerText(), '0.00');
        assert.equal(await graph.locator('.graph-extrema span').first().innerText(), `Peak Red ${exactLabel}`);
        await page.evaluate(() => window.__complete());
        // A new incomplete search must not replace this stored exact result.
        await page.keyboard.press('e');
        await page.evaluate(() => { window.__wire = 'cp 900 lowerbound'; });
        await page.getByTestId('deep-dive-btn').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-pv-line-0"] .pv-line-standing')?.textContent === 'Not exact');
        await command(page, 'Evaluation graph');
        assert.equal(await graph.locator('.graph-legend strong').innerText(), `Red POV ${exactLabel}`, 'A live bound must not displace a stored exact graph score');
        assert.equal(await graph.locator('.graph-point-bound').count(), 0);
        await page.evaluate(() => { window.__wire = ''; });
        await navigator.focus();
        await page.keyboard.press('Home');
        await page.waitForFunction(() => document.querySelector('.winrate-graph')?.getAttribute('aria-valuetext') === 'Start position, Not evaluated');
        assert.equal(await graph.getByTestId('graph-bound-note').count(), 0, 'A bound must not follow the cursor to another position');
        await page.keyboard.press('End');
        await page.waitForFunction(label => document.querySelector('.graph-legend strong')?.textContent === `Red POV ${label}`, exactLabel);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}/${black ? 'Black' : 'Red'}: graph bounds, exact-only summaries, same-score direction changes, exact recovery and navigation passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
