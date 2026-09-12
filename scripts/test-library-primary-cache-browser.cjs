const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      let tree = [{ uci: 'a8a9', recordedResult: 'draw' }];
      for (let i = 254; i >= 0; i--) tree = [{ uci: ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4], children: tree }];
      const games = Array.from({ length: 400 }, (_, i) => ({ id: 'profile-' + i, savedAt: i + 1, gameMode: 'PvP', label: 'Study alpha beta ' + i, moves: [], moveTree: tree }));
      const payload = JSON.stringify(games);
      window.__profilePayloadBytes = new TextEncoder().encode(payload).length;
      localStorage.setItem('xiangqi:library:v1', payload);
      window.__profileNodeVisits = 0;
      const add = Set.prototype.add;
      Set.prototype.add = function(value) {
        if (value && typeof value === 'object' && typeof value.uci === 'string') window.__profileNodeVisits++;
        return add.call(this, value);
      };
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
    await page.goto(base);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('Library');
    await page.keyboard.press('Enter');
    await page.getByRole('combobox', { name: 'Filter by result', exact: true }).selectOption('draw');
    const search = page.getByRole('searchbox', { name: 'Search library' });
    await search.fill('alpha');
    await page.getByTestId('load-saved-profile-399').waitFor();
    if (browserType.name() === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    const samples = [];
    for (const query of ['beta', 'study', 'alpha beta', 'study alpha', 'alpha']) {
      await page.evaluate(() => { window.__profileNodeVisits = 0; });
      const start = performance.now();
      await search.fill(query);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      samples.push({ query, elapsedMs: +(performance.now() - start).toFixed(1), nodeVisits: await page.evaluate(() => window.__profileNodeVisits) });
    }
    assert.ok(samples.every(sample => sample.nodeVisits === 0), JSON.stringify(samples));
    // A storage refresh with the same IDs must invalidate both the primary
    // line and result-search caches. Keep the panel mounted throughout.
    const updateRecord = async pinned => page.evaluate(pinned => {
      const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
      const game = games.find(game => game.id === 'profile-399');
      if (pinned) {
        game.mainLinePinned = true;
        game.moveTree.unshift({ uci: 'b2e2', recordedResult: 'black-wins' });
      } else {
        let node = game.moveTree[0];
        while (node.children?.length) node = node.children[0];
        node.recordedResult = 'red-wins';
      }
      localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
      dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
    }, pinned);
    const resultFilter = page.getByRole('combobox', { name: 'Filter by result', exact: true });
    await updateRecord(false);
    await page.getByTestId('load-saved-profile-399').waitFor({ state: 'hidden' });
    await resultFilter.selectOption('red');
    await page.getByTestId('load-saved-profile-399').waitFor();
    await search.fill('Red wins');
    await page.getByTestId('load-saved-profile-399').waitFor();
    await updateRecord(true);
    await page.getByTestId('load-saved-profile-399').waitFor({ state: 'hidden' });
    await resultFilter.selectOption('black');
    await search.fill('Black wins');
    await page.getByTestId('load-saved-profile-399').waitFor();
    const card = page.getByTestId('load-saved-profile-399').locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," lib-card ")][1]');
    assert.match(await card.innerText(), /1 main-line move/);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
      if (width < 900) {
        await page.getByTestId('mobile-view-analysis').click();
        await page.getByTestId('mobile-analysis-tab-library').click();
      }
      await card.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browserType.name(), fixture: '400 studies of 256 plies; warm result/text filtering; same-ID endpoint and pin refresh; desktop/mobile layout', cpuSlowdown: browserType.name() === 'chromium' ? 4 : 1, payloadBytes: await page.evaluate(() => window.__profilePayloadBytes), samples }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
