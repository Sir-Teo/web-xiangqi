const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(width => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 18 });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
          Object.defineProperty(screen, 'width', { get: () => width });
          Object.defineProperty(screen, 'height', { get: () => 900 });
        }, width);
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__reviewBoots = 0; window.__heldSearches = 0; window.__holdReview = false;
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async options => {
            window.__reviewBoots++;
            let position = ''; const listeners = []; const emit = line => listeners.forEach(fn => fn(line));
            return { variant: options.variant, addMessageListener: fn => listeners.push(fn), terminate() {},
              postMessage(command) {
                if (command.startsWith('position ')) position = command;
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  const move = position === 'position startpos' ? 'h2e2' : position.endsWith('h2e2') ? 'h9g7' : 'h0g2';
                  if (window.__holdReview && ++window.__heldSearches >= 2) {
                    window.__lateReview = () => { emit('info depth 18 score cp 900 pv ' + move); emit('bestmove ' + move); };
                    return;
                  }
                  emit('info depth 12 score cp ' + (window.__holdReview ? 600 : 0) + ' pv ' + move);
                  emit('bestmove ' + move);
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              } };
          };` }));
        await page.goto(base + '?moves=h2e2+h9g7'); await page.locator('.xiangqi-board').waitFor();
        await page.getByTestId('start-engine-analysis').click();
        await command(page, 'Review panel');
        const save = async () => {
          const count = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length);
          await command(page, 'Save game');
          await page.waitForFunction(count => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length > count, count);
          return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        };
        await page.getByTestId('start-review-btn').click(); await page.getByTestId('rerun-review-btn').waitFor();
        const previous = (await save()).review;
        assert.ok(previous); assert.ok(previous.annotations.every(a => a.evalScore === 0));
        for (const action of (width === 1440 ? ['hash', 'threads', 'defaults', 'restart'] : ['hash', 'defaults', 'restart'])) {
          await page.evaluate(() => { window.__holdReview = true; window.__heldSearches = 0; });
          await page.getByTestId('rerun-review-btn').click();
          await page.waitForFunction(() => window.__heldSearches === 2);
          await page.evaluate(() => { window.__terminatedReviewReply = window.__lateReview; });
          const boots = await page.evaluate(() => window.__reviewBoots);
          if (action === 'restart') await command(page, 'Restart engine');
          else {
            await command(page, 'Settings');
            await page.getByTestId('advanced-engine-settings').locator('summary').click();
            await page.getByRole('group', { name: 'Engine Hash', exact: true }).locator('[aria-pressed="true"]').click();
            assert.equal(await page.evaluate(() => window.__reviewBoots), boots, 'Re-selecting the same resources must not restart');
            const button = action === 'hash' ? `Engine hash ${width === 1440 ? 512 : 128} megabytes`
              : action === 'threads' ? 'Engine threads 1' : 'Use device defaults';
            await page.getByRole('button', { name: button, exact: true }).click();
            await page.getByRole('button', { name: 'Close settings', exact: true }).click();
          }
          await page.waitForFunction(boots => window.__reviewBoots > boots, boots);
          const notice = page.getByTestId('review-error'); await notice.waitFor({ timeout: 3000 });
          assert.match(await notice.innerText(), /engine restarted.*Existing scores were kept.*reviewing again/);
          assert.equal(await notice.getAttribute('role'), 'alert');
          assert.equal(await page.getByTestId('cancel-review-btn').count(), 0);
          await page.evaluate(() => { window.__terminatedReviewReply(); window.__holdReview = false; });
          assert.deepEqual((await save()).review, previous, `${action}: preserve the complete review and reject late results`);
          await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
          await notice.scrollIntoViewIfNeeded();
          assert.equal(await notice.evaluate(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1), false);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-review-restart-${browserType.name()}-${width}-${action}.png` });
          await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
          await page.getByTestId('rerun-review-btn').click(); await page.getByTestId('rerun-review-btn').waitFor();
          assert.equal(await notice.count(), 0, 'A new review clears the interruption notice');
          const retry = (await save()).review;
          assert.equal(retry.summary.accuracy, previous.summary.accuracy);
          assert.deepEqual(retry.annotations, previous.annotations);
          // Later interruptions must preserve the most recently completed run.
          Object.assign(previous, retry);
        }
        const finishedBoots = await page.evaluate(() => window.__reviewBoots);
        await command(page, 'Restart engine');
        await page.waitForFunction(boots => window.__reviewBoots > boots, finishedBoots);
        await page.getByTestId('rerun-review-btn').waitFor();
        assert.equal(await page.getByTestId('review-error').count(), 0, 'Completed reviews are not interrupted by a later restart');
        assert.deepEqual((await save()).review, previous);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: resource/restart interruptions preserve prior review, reject late output, and allow retry`);
      } catch (error) {
        console.error(await page.evaluate(() => ({ boots: window.__reviewBoots, held: window.__heldSearches, running: Boolean(document.querySelector('[data-testid="cancel-review-btn"]')) })));
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
