const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__boots = 0; window.__commands = []; window.__bootTimes = [];
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            window.__boots++;
            window.__bootTimes.push(Date.now());
            if (window.__failAllBoots) throw new Error('Controlled startup failure');
            const listeners = [];
            const emit = line => listeners.forEach(listener => listener(line));
            window.__crash = () => emit('[worker-error] Controlled engine failure');
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
              postMessage(command) {
                window.__commands.push(command);
                if (command === 'uci') queueMicrotask(() => emit('uciok'));
                if (command === 'isready') queueMicrotask(() => emit('readyok'));
                if (command.startsWith('go ')) queueMicrotask(() => {
                  emit('info depth 10 score cp 20 pv h2e2'); emit('bestmove h2e2');
                });
                if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
              }
            };
          };
        ` }));
        await page.clock.install();
        await page.goto(base);
        await page.keyboard.press('e');
        await page.getByTestId('engine-pv-0-move-0').waitFor();
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));

        await page.evaluate(() => window.__crash());
        await page.clock.runFor(100);
        assert.equal(await page.evaluate(() => window.__boots), 1, 'Recovery restarted during the navigation grace period');
        // Deterministic lifecycle simulation complements real reload coverage.
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        await page.clock.runFor(1000);
        assert.equal(await page.evaluate(() => window.__boots), 1, 'A departed page started a replacement worker');
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await page.clock.runFor(300);
        assert.equal(await page.evaluate(() => window.__boots), 2, 'Returning page did not recover');
        await page.clock.runFor(500);
        await page.getByTestId('engine-pv-0-move-0').waitFor();

        await page.clock.runFor(1100);
        await page.evaluate(() => window.__crash());
        await page.getByTestId('restart-engine-btn').click();
        await page.clock.runFor(25);
        assert.equal(await page.evaluate(() => window.__boots), 3);
        await page.clock.runFor(1000);
        assert.equal(await page.evaluate(() => window.__boots), 3, 'Pending recovery replaced the manually restarted engine');

        await page.evaluate(() => window.__crash());
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox').fill('Settings');
        await page.keyboard.press('Enter');
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.clock.runFor(1000);
        assert.equal(await page.evaluate(() => window.__boots), 3, 'Disabled analysis still recovered in the background');
        await page.locator('#settings-workspace-mode').selectOption('analysis');
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.keyboard.press('e');
        await page.clock.runFor(1000);
        assert.equal(await page.evaluate(() => window.__boots), 4);
        await page.clock.resume();
        await page.getByTestId('engine-pv-0-move-0').waitFor();

        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
        await page.clock.runFor(16000); // The earlier recovery leaves the rolling budget.
        await page.evaluate(() => { window.__failAllBoots = true; });
        await page.getByTestId('restart-engine-btn').click();
        for (let step = 0; step < 16; step++) await page.clock.runFor(300);
        assert.equal(await page.evaluate(() => window.__boots), 8, 'Fast startup failures were dropped or retried without a bound');
        const attempts = await page.evaluate(() => window.__bootTimes.slice(5));
        // Recovery callbacks have a one-second cooldown; React can commit the
        // resulting worker creation at the end of a 300ms clock step.
        assert.ok(attempts[1] - attempts[0] >= 700 && attempts[2] - attempts[1] >= 700, `Repeated recovery ignored its cooldown: ${JSON.stringify(attempts)}`);
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        assert.match(await page.locator('body').innerText(), /Engine paused after crashes/);
        await page.clock.runFor(5000);
        assert.equal(await page.evaluate(() => window.__boots), 8, 'The crash budget did not stop recovery');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: navigation, return, manual restart, disable and bounded crash recovery passed at ${width}px`);
      } catch (error) {
        console.error(await page.evaluate(() => ({ commands: window.__commands, boots: window.__boots, text: document.body.innerText })));
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
