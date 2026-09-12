const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
function glyphs(tree, path = []) {
  return (tree || []).flatMap(node => [[path.concat(node.uci).join(' '), node.nags], ...glyphs(node.children, path.concat(node.uci))]).sort((a, b) => a[0].localeCompare(b[0]));
}
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
        await importPgn(page, width, 'h2e2 {[%eval .42,18]} (b2e2 $255 {Side note}) h9g7 *');
        await command(page, 'Move tree');
        await page.locator('.mtree-chip').filter({ hasText: 'h2e2' }).click();
        const details = page.getByTestId('imported-glyphs');
        await details.locator(':scope > summary').click();
        const choose = () => page.getByRole('combobox', { name: 'Add study annotation' });
        const apply = async code => { await choose().selectOption(code); await details.getByRole('button', { name: 'Apply symbol', exact: true }).click(); };
        await choose().selectOption('1');
        assert.equal((await save(page)).moveTree[0].nags, undefined, 'Browsing symbols changed the study before Apply');
        await choose().focus(); await page.keyboard.press(browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Apply symbol');
        await page.keyboard.press('Enter');
        await details.getByRole('status').filter({ hasText: 'Good move' }).waitFor({ state: 'attached' });
        await apply('14'); await apply('3');
        const edited = await save(page);
        assert.deepEqual(edited.moveTree[0].nags, [14, 3]);
        assert.equal(edited.moveTree[0].evalScore, 42); assert.equal(edited.moveTree[0].evalDepth, 18);
        assert.equal(edited.moveTree[0].quality, undefined, 'Authoring fabricated an engine grade');
        assert.deepEqual(edited.moveTree[1].nags, [255]);
        await details.getByRole('button', { name: 'Remove Very good move ($3)', exact: true }).click();
        assert.equal(await choose().evaluate(el => el === document.activeElement), true, 'Removing an annotation lost keyboard focus');
        await details.locator('.glyph-code-editor > summary').click();
        const numeric = page.getByRole('textbox', { name: 'Numeric PGN annotation' });
        await numeric.fill('256'); await details.getByRole('button', { name: 'Add code', exact: true }).click();
        await details.getByRole('alert').filter({ hasText: '0 to 255' }).waitFor();
        assert.deepEqual((await save(page)).moveTree[0].nags, [14]);
        await numeric.fill('255'); await details.getByRole('button', { name: 'Add code', exact: true }).click();
        assert.deepEqual((await save(page)).moveTree[0].nags, [14, 255]);
        for (const font of [16, 32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, font);
          if (width === 320) await page.setViewportSize({ width, height: 480 });
          await assertFits(page);
          const controls = await details.locator('button, input, select').evaluateAll(els => els.filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect().height));
          assert.ok(controls.every(height => height >= 44), JSON.stringify(controls));
          await choose().scrollIntoViewIfNeeded();
          if (font === 32) await page.screenshot({ path: `/tmp/xiangqi-edit-glyphs-${browserType.name()}-${width}.png` });
        }
        await page.locator('.mtree-chip').filter({ hasText: 'b2e2' }).click();
        await details.locator(':scope > summary').click(); await apply('5');
        const beforeReload = await save(page);
        assert.deepEqual(beforeReload.moveTree[1].nags, [255, 5]);
        assert.equal(beforeReload.moveTree[1].comment, 'Side note');
        await command(page, 'Copy PGN'); const pgn = await page.evaluate(() => window.__copied);
        assert.match(pgn, /\$14/); assert.match(pgn, /\$255/); assert.match(pgn, /\$5/);
        await importPgn(page, width, pgn);
        assert.deepEqual(glyphs((await save(page)).moveTree), glyphs(beforeReload.moveTree));
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.some(node => node.nags?.includes(5)));
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        assert.deepEqual(glyphs((await save(page)).moveTree), glyphs(beforeReload.moveTree));
        await command(page, 'Copy link'); const link = await page.evaluate(() => window.__copied);
        await page.goto(link); await page.getByRole('button', { name: "Keep the link's game", exact: true }).click();
        assert.deepEqual(glyphs((await save(page)).moveTree), glyphs(beforeReload.moveTree));
        // Authoring a previously bare straight line must enable annotated storage.
        await importPgn(page, width, 'h2e2 *'); await command(page, 'Move tree');
        await details.locator(':scope > summary').click(); await apply('1');
        assert.deepEqual((await save(page)).moveTree, [{ uci: 'h2e2', nags: [1] }]);
        await details.getByRole('button', { name: 'Remove Good move ($1)', exact: true }).click();
        assert.equal((await save(page)).moveTree, undefined);
        await details.locator('.glyph-code-editor > summary').click(); await numeric.fill('200');
        await importPgn(page, width, 'h2e2 *'); await command(page, 'Move tree');
        if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
        assert.equal(await numeric.inputValue(), '', 'A new study inherited the numeric draft on a reused node ID');
        await command(page, 'Go to start'); assert.equal(await details.count(), 0);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: annotation authoring, replacement/removal, invalid codes, unchanged scores/siblings, keyboard focus, short-screen enlarged text, save/recovery/PGN/share passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
