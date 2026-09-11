const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const fixture = '[Result "1/2-1/2"]\n{Root plan} 1.h2e2 (1.b2e2 {[%xqresult 0-1] Resigned}) h9g7 {Agreed draw} 1/2-1/2';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function dismissResult(page) {
  const modal = page.locator('.game-over-modal');
  if (await modal.count()) await modal.getByRole('button', { name: 'Review', exact: true }).click();
}
async function copyPgn(page, expected) {
  await command(page, 'Copy PGN');
  const pgn = await page.evaluate(() => window.__copied);
  assert.ok(pgn.includes(`[Result "${expected}"]`), pgn);
  assert.ok(pgn.trimEnd().endsWith(expected), pgn);
  return pgn;
}
const move = (page, uci) => page.locator('.mtree-chip').filter({ has: page.locator('.move-uci', { hasText: uci }) });
async function importPgn(page, text) {
  await dismissResult(page);
  const mobile = page.viewportSize().width < 900;
  if (mobile) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: mobile ? 'Open new game menu' : 'Start new game', exact: true }).click();
  await page.getByTestId('uci-line-input').fill(text);
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
  await page.keyboard.press('t');
}
async function install(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } }));
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
      const viewport = { width, height: width === 320 ? 640 : width === 390 ? 844 : 900 };
      const page = await browser.newPage({ viewport, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await install(page);
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'legacy-draw', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'], result: 'draw' }])));
        await page.goto(base); await importPgn(page, fixture);
        await copyPgn(page, '1/2-1/2');
        await command(page, 'Go to start'); await command(page, 'Go to latest move');
        await copyPgn(page, '1/2-1/2');
        assert.match(await page.getByTestId('recorded-line-result').innerText(), /Draw/);
        await page.getByTestId('recorded-line-result').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/xiangqi-recorded-result-${browserType.name()}-${width}.png` });
        await move(page, 'b2e2').click(); await copyPgn(page, '0-1');
        await move(page, 'h2e2').click(); await command(page, 'Set this as study main line');
        await move(page, 'b2e2').click(); await copyPgn(page, '1/2-1/2');
        await command(page, 'Save game');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.result, 'black');
        assert.equal(saved.moveTree[0].children[0].recordedResult, 'draw');
        assert.equal(saved.moveTree[1].recordedResult, 'black-wins');
        await command(page, 'Library');
        await page.getByTestId(`copy-pgn-saved-${saved.id}`).click();
        assert.match(await page.evaluate(() => window.__copied), /\[Result "1\/2-1\/2"\]/);
        await page.getByTestId(`load-saved-${saved.id}`).click(); await dismissResult(page); await page.keyboard.press('t');
        await command(page, 'Go to start');
        const exported = await copyPgn(page, '1/2-1/2');
        await command(page, 'Copy link');
        const url = await page.evaluate(() => window.__copied);
        const recipient = await browser.newPage({ viewport, hasTouch: width < 900 });
        try {
          await install(recipient); await recipient.goto(url); await recipient.keyboard.press('t');
          await copyPgn(recipient, '1/2-1/2');
          await command(recipient, 'Let PGN follow the selected line');
          await move(recipient, 'b2e2').click(); await copyPgn(recipient, '0-1');
        } finally { await recipient.close(); }
        await page.waitForFunction(() => {
          const game = JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game;
          return game?.moves.length === 0 && game.moveTree?.[0]?.children?.[0]?.recordedResult === 'draw';
        });
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click(); await page.keyboard.press('t');
        await copyPgn(page, '1/2-1/2');
        await importPgn(page, exported); await command(page, 'Let PGN follow the selected line');
        await move(page, 'b2e2').click(); await copyPgn(page, '0-1');
        await command(page, 'Library');
        const collection = page.getByTestId('pgn-collection-import');
        await collection.locator('summary').click();
        const collectionPgn = exported.replace(/\[Event "[^"\n]*"\]/, '[Event "Result roundtrip"]');
        await collection.getByLabel('Choose PGN collection').setInputFiles({ name: 'Results.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(collectionPgn) });
        await collection.getByRole('button', { name: 'Import 1 game', exact: true }).click();
        await collection.getByRole('status').filter({ hasText: 'Imported 1 game.' }).waitFor();
        const collected = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).find(game => game.metadata?.event === 'Result roundtrip'));
        await page.getByTestId(`load-saved-${collected.id}`).click(); await dismissResult(page); await page.keyboard.press('t');
        await command(page, 'Let PGN follow the selected line');
        await move(page, 'b2e2').click(); await copyPgn(page, '0-1');
        // Old saves gain a durable endpoint result when loaded.
        await command(page, 'Library'); await page.getByTestId('load-saved-legacy-draw').click(); await dismissResult(page);
        await command(page, 'Go to start'); await command(page, 'Go to latest move'); await page.keyboard.press('t');
        await copyPgn(page, '1/2-1/2');
        // Extending the game retains the declaration on the former endpoint.
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        for (const [file, rank] of [[7, 0], [6, 2]]) await page.locator(`.xiangqi-board .hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        await page.keyboard.press('t');
        assert.ok((await copyPgn(page, '*')).includes('[%xqresult 1/2-1/2]'));
        await command(page, 'Delete this move and what follows'); await copyPgn(page, '1/2-1/2');
        await page.getByTestId('delete-undo-btn').click(); await copyPgn(page, '*');
        // Undo restores the declaration when its move was deleted and replayed.
        await move(page, 'h9g7').click(); await command(page, 'Delete this move and what follows');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        for (const [file, rank] of [[7, 9], [6, 7]]) await page.locator(`.xiangqi-board .hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        await page.keyboard.press('t'); await page.getByTestId('delete-undo-btn').click();
        await copyPgn(page, '1/2-1/2');
        // Root-only declarations also survive PGN, saving and share links.
        await importPgn(page, '[Result "1/2-1/2"]\n1/2-1/2');
        await copyPgn(page, '1/2-1/2'); await command(page, 'Save game');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1).rootResult), 'draw');
        await command(page, 'Copy link');
        const rootUrl = await page.evaluate(() => window.__copied);
        const rootRecipient = await browser.newPage({ viewport });
        try {
          await install(rootRecipient);
          await rootRecipient.addInitScript(() => localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({ version: 1, savedAt: Date.now(), game: { id: 'auto-save', savedAt: Date.now(), gameMode: 'PvP', moves: ['h2e2'], result: 'ongoing' } })));
          await rootRecipient.goto(rootUrl);
          await rootRecipient.getByRole('button', { name: "Keep the link's game", exact: true }).click();
          await rootRecipient.keyboard.press('t');
          await rootRecipient.getByTestId('recorded-line-result').waitFor();
          await copyPgn(rootRecipient, '1/2-1/2');
        }
        finally { await rootRecipient.close(); }
        await importPgn(page, '1.h2e2 *'); await copyPgn(page, '*');
        assert.equal(await page.getByTestId('recorded-line-result').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: declared results survive navigation, branch/pin changes, library, recovery, PGN/share, extension/undo, legacy saves and root records`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
