const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[390, 900], [320, 900], [844, 390], [1440, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          const games = Array.from({ length: 400 }, (_, i) => ({ id: 'visibility-' + i, savedAt: i + 1, gameMode: 'PvP', label: 'Study ' + i, moves: Array.from({ length: 1024 }, (_, ply) => cycle[ply % 4]) }));
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
          window.__indexWork = { workers: 0, builds: 0, lookups: 0, moves: 0 };
          const NativeWorker = Worker;
          window.Worker = function(url, options) {
            const worker = new NativeWorker(url, options);
            if (String(url).includes('positionExplorer.worker')) {
              window.__indexWork.workers++;
              const post = worker.postMessage.bind(worker);
              worker.postMessage = data => {
                if (data.type === 'build') { window.__indexWork.builds++; window.__indexWork.moves += data.games.reduce((sum, game) => sum + game.moves.length, 0); }
                if (data.type === 'lookup') window.__indexWork.lookups++;
                post(data);
              };
            }
            return worker;
          };
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => { emit('readyok'); window.__engineReady = true; });
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base + '?moves=a0a1+a9a8+a1a0+a8a9');
        await page.locator('.xiangqi-board').waitFor();
        if (await page.getByTestId('start-engine-analysis').isVisible()) await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => window.__engineReady);
        await settle(page);
        const startup = await page.evaluate(() => window.__indexWork);
        console.log(`${browserType.name()} ${width}x${height}: ${width < 900 ? "hidden" : "visible"} startup ${JSON.stringify(startup)}`);
        if (width < 900) assert.deepEqual(startup, { workers: 0, builds: 0, lookups: 0, moves: 0 });
        await command(page, 'Evaluation graph');
        await page.getByTestId('library-continuation-a0a1').waitFor({ state: 'visible', timeout: 30000 });
        const initialWork = await page.evaluate(() => window.__indexWork);
        const initialLookups = initialWork.lookups;
        // The dev runner uses StrictMode, which replays the initial desktop
        // mount. A phone opens the explorer after mounting and needs one build.
        assert.ok(initialWork.workers >= 1 && initialWork.workers <= (width < 900 ? 1 : 2));
        assert.equal(initialWork.builds, initialWork.workers);
        assert.equal(initialWork.moves, initialWork.builds * 409600);
        assert.ok(initialLookups >= initialWork.workers && initialLookups <= initialWork.workers + (width < 900 ? 0 : 1));
        await command(page, 'Library');
        await command(page, 'Go to start');
        await settle(page);
        assert.equal(await page.evaluate(() => window.__indexWork.lookups), initialLookups, 'Hidden navigation dispatched a lookup');
        await command(page, 'Evaluation graph');
        await page.getByTestId('library-continuation-a0a1').waitFor({ state: 'visible' });
        await page.waitForFunction(count => window.__indexWork.lookups === count, initialLookups + 1);
        assert.equal(await page.evaluate(() => window.__indexWork.builds), initialWork.builds, 'Reopening rebuilt an unchanged index');
        await command(page, 'Library');
        for (let version = 0; version < 5; version++) {
          await page.evaluate(version => {
            const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
            for (const game of games) { game.moves = ['h2e2', 'h9g7']; game.label = 'Version ' + version; }
            localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
            dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
          }, version);
          await settle(page);
        }
        assert.equal(await page.evaluate(() => window.__indexWork.builds), initialWork.builds, 'Hidden storage changes rebuilt the index');
        assert.equal(await page.evaluate(() => window.__indexWork.lookups), initialLookups + 1);
        await command(page, 'Evaluation graph');
        await page.getByTestId('library-continuation-h2e2').waitFor({ state: 'visible' });
        assert.equal(await page.getByTestId('library-continuation-a0a1').count(), 0, 'Old library result survived reopening');
        assert.deepEqual(await page.evaluate(() => window.__indexWork), { workers: initialWork.workers, builds: initialWork.builds + 1, lookups: initialLookups + 2, moves: initialWork.moves + 800 });
        for (const size of [32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await settle(page);
          await page.getByTestId('library-continuation-h2e2').scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        await page.getByTestId('library-continuation-h2e2').click();
        if (width < 900) await command(page, 'Evaluation graph');
        await page.getByTestId('library-continuation-h9g7').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => window.__indexWork.builds), initialWork.builds + 1);
        if (width >= 900) {
          const before = await page.evaluate(() => window.__indexWork.lookups);
          await page.getByTestId('left-panel-resize-handle').focus();
          await page.keyboard.press('Home');
          await command(page, 'Go to start');
          await settle(page);
          assert.equal(await page.evaluate(() => window.__indexWork.lookups), before, 'Collapsed panel dispatched a lookup');
          await command(page, 'Evaluation graph');
          await page.getByTestId('library-continuation-h2e2').waitFor({ state: 'visible' });
          assert.equal(await page.evaluate(() => window.__indexWork.builds), initialWork.builds + 1);
        }
        // Capture the complete result card; all layout assertions above use
        // the original viewport, including the short landscape profile.
        await page.setViewportSize({ width, height: 1800 });
        await page.locator('.library-explorer-card').screenshot({ path: `/tmp/xiangqi-library-visibility-${browserType.name()}-${width}x${height}.png` });
        await page.setViewportSize({ width, height });
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: visibility gating, 409,600-move index reuse; reopening, hidden navigation/storage updates, latest results, continuation and enlarged text passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
