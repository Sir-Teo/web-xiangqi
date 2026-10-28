const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) for (const replacing of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'text/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; let depth = 12;
            const emit = line => listeners.forEach(listener => listener(line));
            window.__publishPV = moves => emit('info depth ' + (++depth) + ' multipv 1 score cp 30 pv ' + moves);
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ')) window.__goCount = (window.__goCount || 0) + 1;
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base);
        await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'));
        await page.keyboard.press('e');
        await page.waitForFunction(() => window.__goCount > 0);
        // Let panel/options changes settle before publishing the first line.
        // The actual regression dispatches in the DOM commit that shows it.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (replacing) {
          await page.evaluate(() => window.__publishPV('h2e2 h9g7'));
          await page.getByTestId('engine-pv-0-move-0').filter({ hasText: 'C2=5' }).waitFor();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
        const wanted = replacing ? 'b2e2' : 'h2e2';
        await page.evaluate(({ wanted, label }) => {
          document.activeElement?.blur();
          window.__shortcutProbe = null;
          const observer = new MutationObserver(() => {
            const move = document.querySelector('[data-testid="engine-pv-0-move-0"]');
            if (!move || move.disabled || move.textContent.trim() !== label) return;
            observer.disconnect();
            // A committed control must answer a queued key before passive
            // effects get another task. No rAF/polling delay after the update.
            const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
            document.body.dispatchEvent(event);
            window.__shortcutProbe = { prevented: event.defaultPrevented, label: move.textContent };
          });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
          window.__publishPV(wanted + ' h9g7');
        }, { wanted, label: replacing ? 'C8=5' : 'C2=5' });
        await page.waitForFunction(() => window.__shortcutProbe !== null);
        assert.equal((await page.evaluate(() => window.__shortcutProbe)).prevented, true,
          `${width}px: the first Space must handle a ${replacing ? 'changed' : 'newly available'} engine move`);
        await page.waitForFunction(row => {
          const fen = document.querySelector('.bottombar-fen')?.getAttribute('title');
          return fen?.split('/')[7] === row && fen.endsWith(' b - - 1 1');
        }, replacing ? '4C2C1' : '1C2C4');
        assert.equal(await page.locator('.wc-meta strong').innerText(), '1 / 1', 'One key must play exactly one move');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: first Space plays the ${replacing ? 'updated' : 'newly shown'} best move without waiting for another frame`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
