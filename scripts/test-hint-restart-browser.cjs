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
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__hintBoots = 0; window.__holdHint = false; window.__hintSearches = 0; window.__hintPositions = [];
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async options => {
            window.__hintBoots++; window.__currentHash = options.hashMB;
            let position = ''; const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            window.__crashHint = () => emit('[worker-error] Controlled hint interruption');
            return { variant: options.variant, addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                if (command.startsWith('position ')) position = command;
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  window.__hintPositions.push(position);
                  const finish = () => { emit('info depth 12 score cp 10 pv h2e2'); emit('bestmove h2e2'); };
                  if (window.__holdHint) { window.__hintSearches++; window.__finishHeldHint = finish; }
                  else finish();
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const guide = page.getByTestId('beginner-guide'); await guide.waitFor();
        if (height < 700) await guide.locator('summary').click();
        await guide.getByRole('button', { name: 'Play Beginner', exact: true }).click();
        const readyHint = () => page.waitForFunction(() => document.querySelector('[data-testid="hint-btn"]')?.disabled === false, null, { timeout: 4000 });
        await readyHint();
        const board = await page.locator('.bottombar-fen').getAttribute('title');
        for (const action of ['restart', 'hash', 'defaults', 'crash']) {
          await page.evaluate(() => { window.__holdHint = true; window.__hintSearches = 0; });
          await command(page, 'Hint');
          await page.waitForFunction(() => window.__hintSearches === 1);
          assert.match(await page.getByTestId('play-status').innerText(), /Thinking of a hint/);
          await page.evaluate(() => { window.__terminatedHintReply = window.__finishHeldHint; });
          const boots = await page.evaluate(() => window.__hintBoots);
          if (action === 'restart') await command(page, 'Restart engine');
          else if (action === 'crash') await page.evaluate(() => window.__crashHint());
          else {
            await command(page, 'Settings');
            if (action === 'hash') {
              await page.getByRole('group', { name: 'Engine Hash', exact: true }).locator('button[aria-pressed="false"]').last().click();
            } else await page.getByRole('button', { name: 'Use device defaults', exact: true }).click();
            await page.getByRole('button', { name: 'Close settings', exact: true }).click();
          }
          await page.waitForFunction(boots => window.__hintBoots > boots, boots);
          await readyHint();
          assert.equal(await page.getByTestId('play-status').innerText(), 'Play mode');
          await page.evaluate(() => { window.__terminatedHintReply(); window.__holdHint = false; });
          assert.equal(await page.locator('.board-arrow-engine-focus').count(), 0, 'A terminated search must not restore the hint arrow');
          await command(page, 'Hint');
          await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent.startsWith('Hint:'));
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), board, 'A hint never plays a move');
          assert.ok(await page.locator('.board-arrow-engine-focus').count());
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: `/tmp/xiangqi-hint-restart-${browserType.name()}-${width}-${action}.png` });
        }
        // Finished hints also belong to the engine session that produced them.
        const boots = await page.evaluate(() => window.__hintBoots);
        await command(page, 'Restart engine');
        await page.waitForFunction(boots => window.__hintBoots > boots, boots); await readyHint();
        await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent === 'Play mode', null, { timeout: 4000 });
        assert.equal(await page.locator('.board-arrow-engine-focus').count(), 0);
        assert.equal(await page.getByTestId('play-status').innerText(), 'Play mode');

        // A threat search is another manual search tied to the old worker.
        await command(page, 'Settings');
        await page.locator('#settings-workspace-mode').selectOption('analysis');
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.keyboard.press('e');
        const threat = page.getByTestId('show-threat-btn'); await threat.waitFor();
        await page.waitForFunction(() => document.querySelector('[data-testid="show-threat-btn"]')?.disabled === false);
        await page.evaluate(() => { window.__holdHint = true; window.__hintSearches = 0; });
        await threat.click(); await page.waitForFunction(() => window.__hintSearches >= 1);
        const threatBoots = await page.evaluate(() => window.__hintBoots);
        const searchesBeforeRestart = await page.evaluate(() => window.__hintPositions.length);
        await command(page, 'Restart engine');
        await page.waitForFunction(boots => window.__hintBoots > boots, threatBoots);
        await page.waitForFunction(() => document.querySelector('[data-testid="show-threat-btn"]')?.textContent.trim() === 'Threat', null, { timeout: 4000 });
        // The replacement must actually search the real position again.
        await page.waitForFunction(count => window.__hintPositions.length > count, searchesBeforeRestart);
        assert.equal(await page.evaluate(() => window.__hintPositions.at(-1)), 'position startpos');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: hint cancellation/retry, late-output rejection, completed-hint reset and threat restart passed`);
      } catch (error) {
        console.error(await page.evaluate(() => ({ boots: window.__hintBoots, status: document.querySelector('[data-testid="play-status"]')?.textContent, hintDisabled: document.querySelector('[data-testid="hint-btn"]')?.disabled })));
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
