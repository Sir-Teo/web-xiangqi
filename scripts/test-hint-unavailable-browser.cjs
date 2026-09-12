const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const unavailable = 'No hint available. Try again.';
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const mobile = width < 900;
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {}; window.__hintSearches = 0;
          window.Pikafish.createWorkerEngine = async options => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: options.variant, addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) {
                  window.__hintSearches++;
                  window.__finishHint = move => emit('bestmove ' + move);
                }
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const guide = page.getByTestId('beginner-guide'); await guide.waitFor();
        if (height < 700) await guide.locator('summary').click();
        await guide.getByRole('button', { name: 'Play Beginner', exact: true }).click();
        const ready = () => page.waitForFunction(() => document.querySelector('[data-testid="hint-btn"]')?.disabled === false);
        await ready();
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        const feedback = page.getByTestId(mobile ? 'mobile-hint-status' : 'play-status');
        const requestHint = async () => {
          const before = await page.evaluate(() => window.__hintSearches);
          if (mobile) {
            await page.getByTestId('mobile-more-actions-btn').click();
            await page.getByTestId('mobile-hint-btn').click();
          } else await page.getByTestId('hint-btn').click();
          await page.waitForFunction(before => window.__hintSearches === before + 1, before);
          assert.equal(await feedback.innerText(), 'Thinking of a hint…');
          assert.equal(await page.locator('.board-arrow-engine-focus').count(), 0);
        };
        for (const reply of ['(none)', '0000', 'garbage', 'a0a0', 'a0b1', 'a9a8']) {
          await requestHint();
          await page.evaluate(reply => window.__finishHint(reply), reply);
          await ready();
          assert.equal(await feedback.innerText(), unavailable, `Explain an unusable ${reply} response at ${width}px`);
          assert.equal(await page.locator('.board-arrow-engine-focus').count(), 0, 'Never draw an illegal hint');
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        }
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await feedback.scrollIntoViewIfNeeded();
          assert.equal(await feedback.evaluate(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1), false, 'Failure text must fit');
          const hit = await feedback.evaluate(node => { const r = node.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { reachable: node.contains(top), rect: r.toJSON(), top: top?.outerHTML.slice(0, 500), pointerEvents: getComputedStyle(node).pointerEvents }; });
          await page.screenshot({ path: `/tmp/xiangqi-hint-unavailable-${browserType.name()}-${width}-${size}.png` });
          assert.equal(hit.reachable, true, `Failure text must be reachable at ${width}/${size}: ${JSON.stringify(hit)}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          if (mobile) {
            assert.equal(await feedback.getAttribute('aria-live'), 'polite');
            assert.equal(await feedback.getAttribute('aria-atomic'), 'true');
          }
        }
        // A retry replaces the failure with progress, then a legal hint.
        await requestHint(); await page.evaluate(() => window.__finishHint('h2e2')); await ready();
        assert.match(await feedback.innerText(), /^Hint:/);
        assert.ok(await page.locator('.board-arrow-engine-focus').count());
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        await requestHint(); await page.evaluate(() => window.__finishHint('(none)')); await ready();
        assert.equal(await feedback.innerText(), unavailable);
        await command(page, 'Restart engine'); await ready();
        await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent === 'Play mode');
        assert.equal(await feedback.innerText(), mobile ? '' : 'Play mode');
        // Moving while a hint is pending cancels it without showing a failure
        // for the old position when stop produces its empty bestmove.
        await requestHint();
        await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
        await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
        await page.waitForFunction(fen => document.querySelector('.bottombar-fen')?.getAttribute('title') !== fen, fen);
        await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent === 'Play mode');
        assert.equal(await feedback.innerText(), mobile ? '' : 'Play mode');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: empty/invalid hints explain failure, fit at 100/200% text, retry and clear on restart/navigation`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
