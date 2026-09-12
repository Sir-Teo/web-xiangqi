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
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          window.__ancestryVisits = 0;
          const add = Set.prototype.add;
          Set.prototype.add = function(value) {
            if (typeof value === 'string' && /^n[1-9][0-9]*$/.test(value)) window.__ancestryVisits++;
            return Reflect.apply(add, this, [value]);
          };
          const snapshot = (position, move) => ({ version: 1, position, move, score: 125, scoreKind: 'cp', bounded: false,
            depth: 27, savedAt: 1, engine: { name: 'Pikafish context QA', variant: 'single-simd', threads: 1, hashMB: 64 }, multiPv: 1,
            effort: { nodes: 123456, timeMs: 1200, seldepth: 35 } });
          const moves = Array.from({ length: 1000 }, (_, i) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4]);
          let tree = [];
          for (let i = moves.length - 1; i >= 0; i--) {
            const position = i ? 'position startpos moves ' + moves.slice(0, i).join(' ') : 'position startpos';
            if (i === moves.length - 1) window.__finalSource = position;
            // Same board after a cycle, but a different repetition history.
            tree = [{ uci: moves[i], comment: 'Recorded ply ' + (i + 1), analysis: snapshot(i === 4 ? 'position startpos' : position, moves[i]), children: tree }];
          }
          const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 20';
          window.__customSource = 'position fen ' + fen;
          const games = [
            { id: 'deep', label: 'Deep analysis', savedAt: 1, gameMode: 'PvP', moves, moveTree: tree },
            { id: 'custom', label: 'Custom analysis', savedAt: 2, gameMode: 'PvP', startFen: fen, moves: ['h7e7', 'h0g2'], moveTree: [
              { uci: 'a9a8', analysis: snapshot(window.__customSource, 'a9a8') },
              { uci: 'h7e7', analysis: snapshot(window.__customSource, 'h7e7'), children: [
                { uci: 'h0g2', analysis: snapshot(window.__customSource + ' moves h7e7', 'h0g2') },
                { uci: 'b0c2', comment: 'Wrong branch reading', analysis: snapshot(window.__customSource + ' moves a9a8', 'b0c2') },
              ] },
            ] },
          ];
          const payload = JSON.stringify(games);
          window.__payloadBytes = payload.length;
          localStorage.setItem('xiangqi:library:v1', payload);
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
        assert.ok(await page.evaluate(() => window.__payloadBytes) < 3000000, 'Fixture must fit the supported library limit');
        const original = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        await page.evaluate(() => { window.__ancestryVisits = 0; });
        await page.getByTestId('load-saved-deep').click();
        const card = page.getByTestId('saved-analysis-card'); await card.waitFor();
        const visits = await page.evaluate(() => window.__ancestryVisits);
        console.log(`${browserType.name()} ${width}px: node-ID Set additions loading 1,000 snapshots = ${visits}`);
        assert.ok(visits < 20000, 'Loading snapshot contexts must not repeatedly walk every ancestor');
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Recorded ply 1000');
        await card.locator('summary').first().click();
        assert.equal(await card.locator('code').textContent(), await page.evaluate(() => window.__finalSource));
        await card.locator('details summary').click();
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await card.getByRole('button', { name: 'View source position' }).scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-study-load-context-${browserType.name()}-${width}-${size}.png` });
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await command(page, 'Go to start');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Go to next move', exact: true }).filter({ visible: true }).first().click();
        await page.keyboard.press('t');
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Recorded ply 5');
        assert.deepEqual(await card.locator('code').allTextContents(), ['position startpos moves a0a1 a9a8 a1a0 a8a9 a0a1'],
          'Only the next move’s valid snapshot should remain; the selected move’s different-history reading must be discarded');
        await command(page, 'Library'); await page.getByTestId('load-saved-custom').click();
        await card.waitFor(); await card.locator('summary').first().click();
        assert.equal(await card.locator('code').textContent(), await page.evaluate(() => window.__customSource + ' moves h7e7'));
        await command(page, 'Go to start');
        await page.locator('.mtree-chip').filter({ hasText: 'a9a8' }).click();
        await card.waitFor(); await card.locator('summary').first().click();
        assert.equal(await card.locator('code').textContent(), await page.evaluate(() => window.__customSource));
        await page.locator('.mtree-chip').filter({ hasText: 'h7e7' }).click();
        await page.locator('.mtree-chip').filter({ hasText: 'b0c2' }).click();
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Wrong branch reading');
        assert.equal(await card.count(), 0, 'A sibling branch must not supply another branch’s source context');
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: deep snapshot context, repeated-board rejection, Black custom root/counters, sibling isolation and enlarged text passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
