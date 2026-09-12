const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : 900 }, hasTouch: width < 900 });
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
        await page.goto(base); await page.keyboard.press('t');
        // Reproduce losing tournament preparation after erasing the last note.
        const note = page.getByRole('textbox', { name: 'Note on starting position', exact: true });
        await note.fill('Temporary preparation note'); await note.blur();
        const editor = page.getByTestId('game-metadata');
        await editor.locator('summary').click();
        await editor.getByLabel('Red player', { exact: true }).fill('王 Alice');
        await editor.getByLabel('Event', { exact: true }).fill('Autumn Invitational');
        await note.fill(''); await note.blur();
        await page.waitForTimeout(900);
        const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')));
        assert.equal(recovery?.game.metadata?.event, 'Autumn Invitational', 'erasing the last note must retain tournament details');
        assert.deepEqual(recovery.game.moves, []); assert.ok(!recovery.game.rootComment);
        assert.ok(await editor.isVisible(), 'details remain editable without moves or notes');
        await command(page, 'Save game');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === 1);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0]);
        assert.deepEqual(saved.metadata, { redPlayer: '王 Alice', event: 'Autumn Invitational' });
        await command(page, 'Copy PGN');
        const pgn = await page.evaluate(() => window.__copied);
        assert.ok(pgn.includes('[White "王 Alice"]')); assert.ok(pgn.includes('[Event "Autumn Invitational"]'));
        const downloadReady = page.waitForEvent('download'); await command(page, 'Export PGN');
        const file = fs.readFileSync(await (await downloadReady).path(), 'utf8');
        assert.ok(file.includes('[Event "Autumn Invitational"]'));
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.keyboard.press('t'); await editor.locator('summary').click();
        assert.equal(await editor.getByLabel('Red player', { exact: true }).inputValue(), '王 Alice');
        await command(page, 'Library');
        await page.getByRole('searchbox', { name: 'Search library' }).fill('Autumn Invitational');
        await page.getByTestId(`load-saved-${saved.id}`).click(); await page.keyboard.press('t');
        if (await editor.getAttribute('open') === null) await editor.locator('summary').click();
        assert.equal(await editor.getByLabel('Event', { exact: true }).inputValue(), 'Autumn Invitational');
        // The exported record must be accepted even before its first move.
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill(pgn);
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' }); await page.keyboard.press('t');
        if (await editor.getAttribute('open') === null) await editor.locator('summary').click();
        assert.equal(await editor.getByLabel('Event', { exact: true }).inputValue(), 'Autumn Invitational');
        await editor.scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-metadata-only-${browserType.name()}-${width}.png` });
        // Whitespace fields must not leave an empty recovery offer behind.
        for (const input of await editor.locator('input').all()) await input.fill('   ');
        await page.waitForFunction(() => !localStorage.getItem('xiangqi:auto-saved-game:v1'));
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        assert.equal(await page.getByTestId(width < 900 ? 'mobile-save-game-btn' : 'save-game-btn').isEnabled(), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: metadata-only recovery, save, library search/load, PGN round-trip and empty reset passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
