const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
function checkPgn(pgn, expected) {
  assert.ok(pgn.includes(`[Result "${expected}"]`), pgn);
  assert.ok(pgn.trimEnd().endsWith(expected), pgn);
  assert.match(pgn, /h9g7/);
  assert.match(pgn, /\[%xqresult 1\/2-1\/2\]/, 'The earlier draw was discarded');
}
async function install(page, game) {
  await page.addInitScript(game => {
    localStorage.setItem('xiangqi:library:v1', JSON.stringify([game]));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
  }, game);
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
    for (const width of [1440, 390, 320]) {
      for (const scenario of ['annotated-prefix', 'legacy-prefix', 'root', 'complete', 'later-result']) {
        const game = { id: 'study', savedAt: 1, gameMode: 'PvP', label: scenario, result: 'draw',
          moves: scenario === 'root' ? [] : scenario === 'complete' ? ['h2e2', 'h9g7'] : ['h2e2'],
          moveTree: [
            { uci: 'h2e2', comment: 'First move', ...(scenario === 'annotated-prefix' ? { recordedResult: 'draw' } : {}),
              children: [{ uci: 'h9g7', comment: 'Later continuation', ...(scenario === 'later-result' ? { recordedResult: 'black-wins' } : {}) }] },
            { uci: 'b2e2', comment: 'Side line' },
          ],
        };
        const expected = scenario === 'complete' ? '1/2-1/2' : scenario === 'later-result' ? '0-1' : '*';
        const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        try {
          await install(page, game); await page.goto(base); await page.locator('.xiangqi-board').waitFor(); await command(page, 'Library');
          const original = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
          await page.getByTestId('copy-pgn-saved-study').click();
          const libraryPgn = await page.evaluate(() => window.__copied);
          checkPgn(libraryPgn, expected);
          const downloaded = page.waitForEvent('download');
          await page.getByTestId('download-pgn-saved-study').click();
          const chunks = []; for await (const chunk of await (await downloaded).createReadStream()) chunks.push(chunk);
          checkPgn(Buffer.concat(chunks).toString(), expected);
          assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original, 'Export changed the saved record');
          await page.getByTestId('load-saved-study').click();
          const modal = page.locator('.game-over-modal');
          await modal.getByRole('button', { name: 'Review', exact: true }).click();
          await page.keyboard.press('t');
          // Copy immediately at the saved cursor, while its declared draw is active.
          await command(page, 'Copy PGN'); checkPgn(await page.evaluate(() => window.__copied), expected);
          await command(page, 'Go to start'); await command(page, 'Go to latest move');
          await command(page, 'Copy PGN'); checkPgn(await page.evaluate(() => window.__copied), expected);
          // Importing the exported study must not attach a result to the extension.
          if (width < 900) await page.getByTestId('mobile-view-board').click();
          await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
          await page.getByTestId('uci-line-input').fill(libraryPgn);
          await page.getByTestId('import-uci-line-btn').click();
          await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
          if (await modal.count()) await modal.getByRole('button', { name: 'Review', exact: true }).click();
          await page.keyboard.press('t');
          await command(page, 'Copy PGN'); checkPgn(await page.evaluate(() => window.__copied), expected);
          if (expected === '*') assert.equal(await page.getByTestId('recorded-line-result').count(), 0);
          if (scenario === 'legacy-prefix') {
            await page.screenshot({ path: `/tmp/xiangqi-pgn-endpoint-${browserType.name()}-${width}.png` });
            await page.locator('.mtree-chip').filter({ has: page.locator('.move-uci', { hasText: 'h2e2' }) }).click();
            await command(page, 'Save game');
            const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
            assert.equal(saved.moveTree[0].recordedResult, 'draw');
            assert.equal(saved.moveTree[0].children[0].recordedResult, undefined);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.deepEqual(errors, []);
          console.log(`${browserType.name()} ${width}px ${scenario}: library copy/file, current-study copy, navigation and import preserve endpoint ownership`);
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
