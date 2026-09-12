const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
};
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {}; window.__holdHint = false;
          window.Pikafish.createWorkerEngine = async options => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: options.variant, addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  const finish = () => { emit('info depth 12 score cp 10 pv h2e2'); emit('bestmove h2e2'); };
                  if (window.__holdHint) window.__finishHint = finish; else finish();
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const guide = page.getByTestId('beginner-guide'); await guide.waitFor();
        if (height < 700) await guide.locator('summary').click();
        await guide.getByRole('button', { name: 'Play Beginner', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-testid="hint-btn"]')?.disabled === false);
        await command(page, 'Hide arrows and markers');
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        const feedback = page.getByTestId('mobile-hint-status');
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; window.__holdHint = true; delete window.__finishHint; }, size);
          await page.getByTestId('mobile-more-actions-btn').click();
          await page.getByTestId('mobile-hint-btn').click();
          await page.waitForFunction(() => typeof window.__finishHint === 'function');
          await feedback.waitFor({ timeout: 3000 });
          assert.equal(await feedback.innerText(), 'Thinking of a hint…');
          assert.equal(await feedback.getAttribute('aria-live'), 'polite');
          assert.equal(await feedback.getAttribute('aria-atomic'), 'true');
          const checkLayout = async phase => {
            await settle(page); await feedback.scrollIntoViewIfNeeded();
            assert.equal(await feedback.evaluate(node => parseFloat(getComputedStyle(node).fontSize)), size * .8125);
            const board = await page.locator('.xiangqi-board-container').boundingBox();
            assert.ok(board.width >= (width === 844 ? 140 : 250), 'Retain a usable board size');
            assert.ok(Math.abs(board.width / board.height - .9) < .02, 'Preserve the board proportions');
            if (width !== 844) {
              const workspace = await page.locator('.board-workspace').boundingBox();
              assert.ok(board.x - workspace.x >= 9 && workspace.x + workspace.width - board.x - board.width >= 9, 'Keep the decorative side frame inside the scroll container');
            }
            assert.equal(await feedback.evaluate(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1), false, 'Hint feedback must not clip');
            assert.equal(await feedback.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'Hint text must be reachable');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            for (const square of await page.locator('.hitbox').all()) {
              await square.scrollIntoViewIfNeeded();
              const hit = await square.evaluate(node => { const r = node.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { reachable: node.contains(top), rect: r.toJSON(), top: top?.className, label: node.getAttribute('aria-label') }; });
              if (!hit.reachable) await page.screenshot({ path: `/tmp/xiangqi-mobile-hint-failure-${width}-${size}.png` });
              assert.equal(hit.reachable, true, `Hint feedback must leave every intersection reachable at ${width}/${size}: ${JSON.stringify(hit)}`);
            }
            await feedback.scrollIntoViewIfNeeded();
            await page.screenshot({ path: `/tmp/xiangqi-mobile-hint-${browserType.name()}-${width}-${size}-${phase}.png` });
          };
          await checkLayout('thinking');
          await page.evaluate(() => { window.__holdHint = false; window.__finishHint(); });
          await page.waitForFunction(() => document.querySelector('[data-testid="mobile-hint-status"]')?.textContent.startsWith('Hint:'));
          assert.equal(await feedback.innerText(), await page.getByTestId('play-status').innerText(), 'Phone and desktop must name the same move');
          assert.equal(await page.locator('.board-arrow-engine-focus').count(), 0, 'The text must work with arrows hidden');
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
          await checkLayout('ready');
        }
        for (const label of ['Write moves in coordinates (UCI)', 'Write moves in Chinese (中文)']) {
          await command(page, label); await settle(page);
          assert.equal(await feedback.innerText(), await page.getByTestId('play-status').innerText());
          if (label.includes('UCI')) assert.equal(await feedback.innerText(), 'Hint: H2E2');
          else assert.match(await feedback.innerText(), /Hint: .*炮/);
          await feedback.scrollIntoViewIfNeeded();
          assert.equal(await feedback.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
        }
        await command(page, 'Restart engine');
        await page.waitForFunction(() => document.querySelector('[data-testid="mobile-hint-status"]')?.textContent === '');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: touch hints announce progress/move with arrows off and fit at 100/200% text`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
