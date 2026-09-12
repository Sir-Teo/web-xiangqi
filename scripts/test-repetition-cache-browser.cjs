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
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'long-repetition', label: 'Long repetition', savedAt: 1, gameMode: 'PvP', moves: Array.from({ length: 1024 }, (_, i) => cycle[i % 4]) },
            { id: 'different-root', label: 'Black check', savedAt: 2, gameMode: 'PvP', startFen: '3k5/4r4/9/9/9/9/9/9/9/4K4 w', moves: ['e0f0', 'e8f8', 'f0e0', 'f8e8'] },
          ]));
          window.__boardSerializations = 0;
          const join = Array.prototype.join;
          Array.prototype.join = function(separator) {
            if (separator === '/' && this.length === 10 && this.every(row => typeof row === 'string' && /^[1-9rnbakcpRNBAKCP]+$/.test(row))) window.__boardSerializations++;
            return Reflect.apply(join, this, [separator]);
          };
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: fn => listeners.push(fn), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const load = async id => {
          await command(page, 'Library'); await page.getByTestId('load-saved-' + id).click();
          if (width < 900) await page.getByTestId('mobile-view-board').click();
        };
        const notice = page.getByTestId('repetition-notice');
        const atPly = async ply => {
          await page.waitForFunction(ply => Number(document.querySelector('.bottombar-fen')?.getAttribute('title')?.split(' ')[4]) === ply, ply);
          assert.match(await notice.innerText(), new RegExp(`Position repeated ${Math.floor(ply / 4) + 1} times`));
        };
        await load('long-repetition'); await atPly(1024);
        assert.ok(await page.evaluate(() => window.__boardSerializations > 1024), 'The probe must observe real board serialization while loading');
        await page.evaluate(() => { window.__boardSerializations = 0; });
        for (let ply = 1023; ply >= 1014; ply--) {
          await page.locator('button[aria-label="Go to previous move"]:visible').first().click();
          await atPly(ply);
        }
        const count = await page.evaluate(() => window.__boardSerializations);
        console.log(`${browserType.name()} ${width}px: full-board serializations across ten backwards steps = ${count}`);
        assert.ok(count < 100, 'Navigating known snapshots must not reserialize the entire history');
        await notice.scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: `/tmp/xiangqi-repetition-cache-${browserType.name()}-${width}.png` });
        await load('different-root');
        assert.match(await notice.innerText(), /Black is checking perpetually/);
        await page.locator('button[aria-label="Go to first position"]:visible').first().click();
        await notice.waitFor({ state: 'hidden' });
        await load('long-repetition'); await atPly(1024);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: repetition count, perpetual-check root, navigation and study reload passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
