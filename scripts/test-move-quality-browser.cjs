const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
async function importRecord(page, width, source) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  await page.getByTestId('uci-line-input').fill(source);
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
  await page.keyboard.press('t');
}
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
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base);
        await importRecord(page, width, 'h2e2 {[%eval -5.00]} h9g7 {[%eval 0.00]} b0c2 {[%eval 0.00]} b9c7 $2 h0g2 {[%eval 5.00]} *');
        const chips = page.locator('.mtree-chip');
        const states = await chips.evaluateAll(nodes => nodes.map(node => ({ classes: node.className, title: node.title, label: node.getAttribute('aria-label'), dot: !!node.querySelector('.mtree-quality-dot') })));
        assert.match(states[0].classes, /quality-pending/, 'A missing root score must not be treated as equal');
        assert.equal(states[0].dot, false);
        assert.match(states[1].classes, /quality-blunder/); assert.match(states[1].title, /Estimated move quality Blunder/); assert.match(states[1].label, /Estimated move quality Blunder/);
        assert.match(states[2].classes, /quality-best/); assert.match(states[2].label, /Estimated move quality Best/);
        assert.match(states[3].classes, /quality-mistake/); assert.match(states[3].label, /Move quality Mistake/); assert.ok(!states[3].label.includes('Estimated'));
        assert.match(states[4].classes, /quality-pending/);
        await page.locator('.mtree-quality-legend').getByText('Estimates compare separate position scores. Run Review to evaluate the whole line.').waitFor();
        await chips.nth(1).click();
        assert.match(await chips.nth(1).getAttribute('aria-label'), /Current move.*Estimated move quality Blunder/);
        // An imported quality mark remains usable even without a starting evaluation.
        await importRecord(page, width, 'h2e2 $2 {[%eval -5.00]} *');
        assert.match(await page.locator('.mtree-chip').getAttribute('class'), /quality-mistake/);
        assert.match(await page.locator('.mtree-chip').getAttribute('title'), /Move quality Mistake/);
        await importRecord(page, width, 'h2e2 (b2e2 $2) *');
        await page.locator('.mtree-quality-legend').getByText('Saved PGN quality marks may use different criteria.').waitFor();
        assert.equal(await page.locator('.mtree-variation .mtree-quality-dot').count(), 1);
        // Black starts from a custom FEN whose true root evaluation is unknown as well.
        const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 20';
        await importRecord(page, width, `[FEN "${fen}"] 20...h7e7 {[%eval 5.00]} *`);
        assert.match(await page.locator('.mtree-chip').getAttribute('class'), /quality-pending/);
        assert.equal(await page.locator('.mtree-quality-legend').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: `/tmp/xiangqi-move-quality-${browserType.name()}-${width}.png` });
        console.log(`${browserType.name()} ${width}px: unknown root/gaps, real zero, both sides, imported marks and accessible estimated quality passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
