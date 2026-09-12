const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
};
async function installEngine(page) {
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
}
(async () => {
  const browser = await browserType.launch();
  try {
    const producer = await browser.newPage();
    await installEngine(producer);
    await producer.addInitScript(() => {
      const moves = Array.from({ length: 1000 }, (_, i) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4]);
      let children = [];
      for (let i = 999; i >= 0; i--) children = [{ uci: moves[i], comment: 'Preparation ' + (i + 1), children,
        analysis: { version: 1, position: i ? 'position startpos moves ' + moves.slice(0, i).join(' ') : 'position startpos', move: moves[i],
          score: 125, scoreKind: 'cp', bounded: true, bound: 'lower', depth: 27, savedAt: 1,
          engine: { name: 'Pikafish backup QA', variant: 'single-simd', threads: 1, hashMB: 64 }, multiPv: 1,
          effort: { nodes: 123456, timeMs: 1200, seldepth: 35 } } }];
      localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'dense', savedAt: 1, gameMode: 'PvP', label: 'Dense preparation', moves, moveTree: children }]));
    });
    await producer.goto(base); await producer.locator('.xiangqi-board').waitFor();
    await command(producer, 'Library'); await producer.getByTestId('load-saved-dense').click();
    const warning = producer.getByTestId('auto-save-error'); await warning.waitFor();
    assert.match(await warning.innerText(), /too large for automatic recovery/);
    const download = producer.waitForEvent('download');
    await warning.getByRole('button', { name: 'Download PGN', exact: true }).click();
    const chunks = [];
    for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
    const buffer = Buffer.concat(chunks), pgn = buffer.toString();
    console.log(`${browserType.name()}: recovery PGN has ${pgn.length} characters and ${(pgn.match(/\[%xqanalysis /g) || []).length} snapshots`);
    assert.ok(pgn.length > 1000000 && pgn.length <= 8000000);
    assert.equal((pgn.match(/\[%xqanalysis /g) || []).length, 1000);
    await command(producer, 'Import a game record');
    await producer.getByTestId('uci-line-file-input').setInputFiles({ name: 'Preparation backup.pgn', mimeType: 'application/x-chess-pgn', buffer });
    assert.match(await producer.locator('#new-game-line-error').innerText(), /Library → Import PGN collection, then Open on board/);
    await producer.close();
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'en-US', hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(blocked => {
          localStorage.setItem('xiangqi:library:v1', blocked ? '{' : JSON.stringify([{ id: 'existing', savedAt: 1, gameMode: 'PvP', label: 'Existing study', moves: ['h2e2'] }]));
          if (blocked) Object.defineProperty(crypto, 'randomUUID', { value: undefined });
        }, width === 320);
        await installEngine(page);
        await page.goto(base + '?moves=h2e2'); await page.locator('.xiangqi-board').waitFor();
        await page.waitForFunction(() => document.querySelector('.bottombar-fen')?.getAttribute('title')?.endsWith('b - - 1 1'));
        const original = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');
        await command(page, 'Library');
        const panel = page.getByTestId('pgn-collection-import'); await panel.locator('summary').click();
        await panel.getByLabel('Choose PGN collection').setInputFiles({ name: 'Preparation backup.pgn', mimeType: 'application/x-chess-pgn', buffer });
        const open = panel.getByRole('button', { name: 'Open game 1 on board', exact: true });
        await open.waitFor({ timeout: 5000 }).catch(async error => {
          console.error('PGN import errors:', await panel.getByRole('alert').allTextContents());
          throw error;
        });
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen, 'Checking the file must not replace the board');
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original);
        if (width === 320) assert.equal(await panel.getByRole('button', { name: 'Import 1 game', exact: true }).isDisabled(), true);
        const initialFont = await open.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.waitForFunction(expected => Math.abs(parseFloat(getComputedStyle(document.querySelector('[aria-label="Open game 1 on board"]')).fontSize) - expected) < 0.01, initialFont * size / 16);
          await open.evaluate(el => el.scrollIntoView({ block: 'center' }));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.ok((await open.boundingBox()).height >= 44);
          const hit = await open.evaluate(el => { const r = el.getBoundingClientRect(); const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { reachable: el.contains(target), rect: r.toJSON(), target: target?.outerHTML.slice(0, 500) }; });
          assert.equal(hit.reachable, true, `${width}px/${size}px: ${JSON.stringify(hit)}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-dense-pgn-backup-${browserType.name()}-${width}-${size}.png` });
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await open.focus(); await page.keyboard.press('Enter');
        await page.getByTestId('saved-analysis-card').waitFor();
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'Preparation 1000');
        const card = page.getByTestId('saved-analysis-card'); await card.locator('summary').first().click();
        assert.match(await card.innerText(), /lower bound|Lower bound/);
        assert.match(await card.innerText(), /123,456 nodes/);
        assert.equal((await card.locator('code').textContent()).split(' moves ')[1].split(' ').length, 999);
        assert.match(await page.locator('.bottombar-fen').getAttribute('title'), /w - - 1000 501$/);
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original, 'Opening a checked backup must not write to the library, even when storage is blocked');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: dense recovery PGN reopened, complete context/effort retained, library untouched and 100/200% preview controls passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
