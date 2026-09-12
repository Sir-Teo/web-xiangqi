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
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'en-US', hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          window.__effortFormats = 0;
          const format = Number.prototype.toLocaleString;
          Number.prototype.toLocaleString = function(...args) {
            if (Number(this) === 123456 || Number(this) === 1200) window.__effortFormats++;
            return Reflect.apply(format, this, args);
          };
          const analysis = { version: 1, position: 'position startpos', move: 'b2e2', score: 125, scoreKind: 'cp', bounded: true, bound: 'lower',
            depth: 27, savedAt: 1, engine: { name: 'Pikafish Research build', variant: 'single-simd', threads: 1, hashMB: 64 }, multiPv: 2,
            candidates: ['b2e2', 'h2e2'], effort: { nodes: 123456, timeMs: 1200, seldepth: 35 } };
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'prepared', savedAt: 1, gameMode: 'PvP', label: 'Prepared study', moves: ['h2e2'], moveTree: [{ uci: 'h2e2' }, { uci: 'b2e2', analysis }] },
            { id: 'ordinary', savedAt: 2, gameMode: 'PvP', label: 'Ordinary study', moves: ['h2e2'] },
          ]));
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Library');
        const search = page.getByRole('searchbox', { name: 'Search library' });
        const matches = () => page.locator('.lib-card[data-game-id]').evaluateAll(cards => cards.map(card => card.dataset.gameId));
        for (const query of ['Pikafish Research', 'saved analysis D27', 'lower bound +1.25', '125cp', 'single-simd 64 MB hash',
          'MultiPV 2 selected candidates', '123456 nodes', '123,456 nodes', '1200ms', '1,200 ms', 'selective depth 35']) {
          await search.fill(query);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.deepEqual(await matches(), ['prepared'], `${width}px: find the saved side-line snapshot for ${query}`);
          const formats = await page.evaluate(() => window.__effortFormats);
          if (query === 'Pikafish Research') assert.ok(formats > 0, 'The probe must observe effort indexing');
          else assert.equal(formats, 0, 'Warm queries must reuse the snapshot search text');
          await page.evaluate(() => { window.__effortFormats = 0; });
        }
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.getByTestId('load-saved-prepared').scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-library-analysis-search-${browserType.name()}-${width}-${size}.png` });
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.getByTestId('load-saved-prepared').click();
        await command(page, 'Go to start'); await page.keyboard.press('t');
        const card = page.getByTestId('saved-analysis-card'); await card.waitFor();
        await card.locator('summary').first().click();
        assert.match(await card.innerText(), /Pikafish Research build/);
        assert.match(await card.innerText(), /123,456 nodes/);
        // The existing lazy index must refresh for updated metadata under the same ID.
        await command(page, 'Library'); await search.fill('Pikafish Research');
        await page.getByTestId('load-saved-prepared').waitFor();
        await page.evaluate(() => {
          const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
          games[0].moveTree[1].analysis.engine.name = 'Pikafish Replacement build';
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
          dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
        });
        await page.getByTestId('load-saved-prepared').waitFor({ state: 'hidden' });
        await search.fill('Pikafish Replacement'); await page.getByTestId('load-saved-prepared').waitFor();
        await page.evaluate(() => {
          const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
          delete games[0].moveTree[1].analysis;
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
          dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
        });
        await page.getByTestId('load-saved-prepared').waitFor({ state: 'hidden' });
        await search.fill('Prepared study'); await page.getByTestId('load-saved-prepared').waitFor();
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: side-line analysis search, opening the result, metadata refresh/removal and 100/200% text passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
