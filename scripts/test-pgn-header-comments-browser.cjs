const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 42';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function openImport(page, width, source, file = false) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  if (file) {
    await page.getByTestId('uci-line-file-input').setInputFiles({ name: 'Preparation.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(source) });
    await page.waitForFunction(source => document.querySelector('[data-testid="uci-line-input"]')?.value === source.replace(/\r\n?/g, '\n'), source);
  } else await page.getByTestId('uci-line-input').fill(source);
  await page.getByTestId('import-uci-line-btn').click();
}
function contents(game) {
  return { moves: game.moves, startFen: game.startFen, rootComment: game.rootComment, moveTree: game.moveTree,
    event: game.metadata?.event, redPlayer: game.metadata?.redPlayer };
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.context().addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async text => { window.__copied = text; } } }));
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
        const save = async () => {
          {
            const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
            await command(page, 'Save game');
            await page.waitForFunction(before => localStorage.getItem('xiangqi:library:v1') !== before, before);
          }
          return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        };
        for (const prefix of ['{Preparation note 开局}', '; Preparation note 开局']) {
          await openImport(page, width, `${prefix}\n[Event "Training"]\nh2e2 $1 {Move note} (b2e2 {Alternative}) h9g7 *`);
          await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
          const saved = await save();
          assert.deepEqual(saved.moves, ['h2e2', 'h9g7'], 'A leading comment silently erased the moves');
          assert.equal(saved.rootComment, 'Preparation note 开局');
          assert.equal(saved.metadata.event, 'Training');
          assert.deepEqual(saved.moveTree[0].nags, [1]);
          assert.equal(saved.moveTree[1].comment, 'Alternative');
        }
        const source = `{Example [FEN "fake"] [Event "Fake"] 1-0}\r\n[Event "Training"]
; Preparation for Black {
[FEN "${fen}"] {Keep the centre} [Red "王"] [Result "*"]
h9g7 $1 {Black develops} (a9a8 {Rook alternative}) h2e2 *`;
        await openImport(page, width, source, true);
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        const saved = await save();
        assert.deepEqual(saved.moves, ['h9g7', 'h2e2']);
        assert.equal(saved.startFen, fen);
        assert.equal(saved.metadata.event, 'Training'); assert.equal(saved.metadata.redPlayer, '王');
        assert.match(saved.rootComment, /Preparation for Black Keep the centre/);
        await page.keyboard.press('t');
        assert.match(await page.locator('.mtree-num').first().innerText(), /42/);
        assert.equal(await page.locator('.mtree-chip').count(), 3);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: `/tmp/xiangqi-pgn-header-comments-${browserType.name()}-${width}.png` });
        await command(page, 'Copy PGN');
        const exported = await page.evaluate(() => window.__copied);
        assert.ok(exported.includes(`[FEN "${fen}"]`));
        await openImport(page, width, exported);
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        assert.deepEqual(contents(await save()), contents(saved));
        await page.waitForFunction(fen => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.startFen === fen, fen);
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        assert.deepEqual(contents(await save()), contents(saved));
        // A newly recognized Result header must still reject a mismatch atomically.
        await openImport(page, width, '{Note}\n[Result "1-0"]\nh2e2 0-1');
        await page.getByText('The Result header disagrees with the final result marker.', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        assert.deepEqual(contents(await save()), contents(saved));
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: leading/interleaved comments, real custom FEN, fake headers, variations, paste/file, PGN round-trip, recovery and rejected-result preservation passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
