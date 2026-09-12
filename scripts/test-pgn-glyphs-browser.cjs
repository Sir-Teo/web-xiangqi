const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
const source = 'h2e2! $14 (b2e2!! $255 a9a8!? (i9i8?!)) h9g7? h0g2?? *';
function glyphs(tree, path = []) {
  return (tree || []).flatMap(node => [[path.concat(node.uci).join(' '), node.nags], ...glyphs(node.children, path.concat(node.uci))]);
}
const expected = [['h2e2', [1, 14]], ['h2e2 h9g7', [2]], ['h2e2 h9g7 h0g2', [4]],
  ['b2e2', [3, 255]], ['b2e2 a9a8', [5]], ['b2e2 i9i8', [6]]];
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function importPgn(page, width, pgn) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  await page.getByTestId('uci-line-input').fill(pgn);
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
}
async function save(page) {
  await command(page, 'Save game');
  return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
}
async function assertFits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const overflow = await page.locator('.mtree-scroll, .imported-glyphs').evaluateAll(elements => elements.flatMap(root =>
    [...root.querySelectorAll('button, li, .mtree-glyphs')].filter(element => element.clientWidth && element.scrollWidth > element.clientWidth + 1).map(element => element.outerHTML.slice(0, 120))));
  assert.deepEqual(overflow, []);
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
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
        await importPgn(page, width, source);
        assert.deepEqual(glyphs((await save(page)).moveTree), expected);
        await command(page, 'Move tree');
        await page.locator('.mtree-chip[data-node-id="n1"]').click();
        assert.equal(await page.locator('.mtree-chip[data-node-id="n1"] .mtree-glyphs').innerText(), '! +=');
        assert.match(await page.locator('.mtree-chip[data-node-id="n1"]').getAttribute('aria-label'), /Good move/);
        await page.getByTestId('imported-glyphs').locator('summary').click();
        await page.getByText('Red has a slight advantage', { exact: false }).last().waitFor();
        await assertFits(page);
        await page.getByTestId('imported-glyphs').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/xiangqi-pgn-glyphs-${browserType.name()}-${width}.png` });
        await command(page, 'Go to latest move');
        await command(page, 'Copy PGN');
        const exported = await page.evaluate(() => window.__copied);
        for (const code of [1, 2, 3, 4, 5, 6, 14, 255]) assert.equal((exported.match(new RegExp('\\$' + code + '(?!\\d)', 'g')) || []).length, 1, `Lost or duplicated $${code}`);
        await importPgn(page, width, exported);
        assert.deepEqual(glyphs((await save(page)).moveTree), expected);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.[0]?.nags?.[0] === 1);
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        assert.deepEqual(glyphs((await save(page)).moveTree), expected);
        await command(page, 'Copy link');
        const link = await page.evaluate(() => window.__copied);
        assert.ok(new URL(link).searchParams.has('tree'));
        await page.goto(link);
        await page.getByRole('button', { name: "Keep the link's game", exact: true }).click();
        assert.deepEqual(glyphs((await save(page)).moveTree), expected);

        // A straight line with only a supplied symbol must not use bare-move storage.
        await importPgn(page, width, 'h2e2! *');
        const single = await save(page);
        assert.deepEqual(single.moveTree, [{ uci: 'h2e2', nags: [1] }]);
        assert.equal(single.review, undefined);
        await command(page, 'Copy link');
        assert.ok(new URL(await page.evaluate(() => window.__copied)).searchParams.has('tree'));

        await command(page, 'Library');
        const panel = page.getByTestId('pgn-collection-import');
        await panel.locator('summary').click();
        await panel.getByLabel('Choose PGN collection').setInputFiles({ name: 'Glyphs.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(source + '\nh2e2 $0 *') });
        await panel.getByRole('button', { name: 'Import 2 games', exact: true }).click();
        await panel.getByRole('status').filter({ hasText: 'Imported 2 games.' }).waitFor();
        const collection = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).slice(-2));
        assert.deepEqual(glyphs(collection[0].moveTree), expected);
        assert.deepEqual(collection[1].moveTree[0].nags, [0]);

        const codes = Array.from({ length: 256 }, (_, code) => `$${code}`).join(' ');
        await importPgn(page, width, 'h2e2 ' + codes + ' *');
        await command(page, 'Move tree');
        const details = page.getByTestId('imported-glyphs');
        if (!await details.getAttribute('open').then(value => value !== null)) await details.locator('summary').click();
        assert.equal(await details.locator('li').count(), 256);
        assert.match(await page.locator('.mtree-glyphs').innerText(), /\+253$/);
        for (const font of [16, 32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, font);
          await assertFits(page);
          if (width === 320 && font === 32) {
            await details.locator('summary').scrollIntoViewIfNeeded();
            await page.screenshot({ path: `/tmp/xiangqi-pgn-glyphs-${browserType.name()}-enlarged.png` });
          }
        }
        assert.deepEqual((await save(page)).moveTree[0].nags, Array.from({ length: 256 }, (_, code) => code));
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: all glyphs, nested PGN, straight-line storage, recovery/share, collection import and enlarged-text display passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
