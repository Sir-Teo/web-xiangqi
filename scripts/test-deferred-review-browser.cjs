const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const isReviewCode = url => /\/(?:assets\/ReviewPanel-[^/]+\.js|src\/components\/Panels\/ReviewPanel\.tsx)(?:\?|$)/.test(url);
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function setup(page) {
  await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.Pikafish = function() {};
    window.Pikafish.createWorkerEngine = async () => {
      const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
      return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
        if (command === 'uci') queueMicrotask(() => emit('uciok'));
        if (command === 'isready') queueMicrotask(() => emit('readyok'));
        if ((command.startsWith('go ') && !window.__holdSearch) || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
      } };
    };` }));
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      try {
        await setup(page);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const requests = []; page.on('request', request => { if (isReviewCode(request.url())) requests.push(request.url()); });
        await page.route(url => isReviewCode(url.href), async route => { await gate; await route.continue(); });
        await page.goto(base + '?moves=h2e2+h9g7');
        await page.getByTestId('start-engine-analysis').click();
        await page.locator('.xiangqi-board').waitFor();
        assert.deepEqual(requests, [], 'Review code must not be fetched at startup');
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        await command(page, 'Review panel');
        const pending = page.getByTestId('review-loading');
        await pending.waitFor();
        assert.equal(await pending.getAttribute('role'), 'status');
        const normalFont = await pending.locator('p').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
        for (const size of [16, 32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.waitForFunction(({ normalFont, size }) => Math.abs(parseFloat(getComputedStyle(document.querySelector('[data-testid="review-loading"] p')).fontSize) - normalFont * size / 16) < .1, { normalFont, size });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.equal(await pending.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
          if (size === 32) await page.screenshot({ path: `/tmp/xiangqi-review-loading-${browserType.name()}-${width}.png` });
        }
        await page.evaluate(() => { window.__holdSearch = true; });
        await command(page, 'Review game');
        await pending.getByRole('button', { name: 'Cancel review', exact: true }).click();
        await pending.getByRole('button').waitFor({ state: 'hidden' });
        await page.evaluate(() => { window.__holdSearch = false; });
        await command(page, 'Move tree');
        await pending.waitFor({ state: 'hidden' });
        release();
        await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => /ReviewPanel.*\.(?:js|tsx)(?:\?|$)/.test(entry.name)));
        assert.equal(await page.locator('.review-panel').count(), 0, 'A late load must not reopen review');
        await command(page, 'Review panel');
        await page.locator('.review-panel [data-testid="start-review-btn"]').waitFor();
        assert.equal(requests.length, 1, 'Reopening review should reuse its code');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        assert.deepEqual(errors, []);
      } finally { release(); await page.close(); }

      const failed = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      try {
        await setup(failed);
        await failed.route(url => isReviewCode(url.href), route => route.abort());
        await failed.goto(base + '?moves=h2e2+h9g7');
        await failed.getByTestId('start-engine-analysis').click();
        await failed.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'));
        await failed.evaluate(() => { window.__holdSearch = true; });
        const fen = await failed.locator('.bottombar-fen').getAttribute('title');
        await command(failed, 'Review game');
        const error = failed.locator('.lazy-panel-error');
        await error.waitFor();
        assert.equal(await error.getAttribute('role'), 'alert');
        const normalErrorFont = await error.locator('p').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
        await failed.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
        await failed.waitForFunction(normalFont => Math.abs(parseFloat(getComputedStyle(document.querySelector('[data-testid="review-load-error"] p')).fontSize) - normalFont * 2) < .1, normalErrorFont);
        await failed.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await failed.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await error.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        await failed.screenshot({ path: `/tmp/xiangqi-review-failed-${browserType.name()}-${width}.png` });
        await error.getByRole('button', { name: 'Cancel review', exact: true }).click();
        await error.getByRole('button').waitFor({ state: 'hidden' });
        await command(failed, 'Move tree');
        await failed.getByTestId('move-comment-input').fill('Study still editable after a failed review download');
        await failed.getByTestId('move-comment-input').blur();
        assert.equal(await failed.locator('.bottombar-fen').getAttribute('title'), fen);
        await command(failed, 'Save game');
        await failed.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length > 0);
        const saved = await failed.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.moveTree[0].children[0].comment, 'Study still editable after a failed review download');
      } finally { await failed.close(); }
      console.log(`${browserType.name()} ${width}px: review code deferred, pending/failed loads contained, enlarged text fits, late load stays closed and study remains editable`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
