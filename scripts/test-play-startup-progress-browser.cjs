const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = options => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            options.onAssetProgress?.({loaded:26859655,total:53719310,done:false});
            return new Promise(resolve => { window.__finishEngineStart = () => resolve({
              variant:'single-simd',terminate(){},addMessageListener: listener => listeners.push(listener),
              postMessage(command) {
                if(command==='uci')queueMicrotask(()=>emit('uciok'));
                if(command==='isready')queueMicrotask(()=>emit('readyok'));
              }
            }); });
          };` }));
        await page.goto(base);
        const guide = page.getByTestId('beginner-guide');
        await guide.waitFor();
        const header = page.locator('.mobile-board-header');
        const beforeHeight = width < 900 ? (await header.boundingBox()).height : null;
        if (height < 700) await guide.locator('summary').click();
        await guide.getByRole('button', { name: 'Play Beginner', exact: true }).click();
        await page.waitForFunction(() => typeof window.__finishEngineStart === 'function');
        if (width < 900) {
          const loading = header.getByRole('status', { name: 'Loading engine, 50% of the weights downloaded', exact: true });
          await loading.waitFor({ timeout: 5000 });
          assert.equal(await loading.innerText(), '50%');
          assert.ok((await header.boundingBox()).height <= beforeHeight + 1, 'Download progress must not wrap the phone header');
        } else {
          await page.getByRole('status', { name: /Loading engine ·/ }).waitFor();
        }
        // The human can move while the engine is still downloading.
        await page.locator('.hitbox[data-file="7"][data-rank="2"]').click();
        await page.locator('.hitbox[data-file="4"][data-rank="2"]').click();
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        await page.evaluate(() => window.__finishEngineStart());
        await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'));
        if (width < 900) assert.equal(await header.locator('.mobile-engine-notice').count(), 0, 'The download notice clears when ready');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: play startup progress, human input, stable header and ready transition passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
