const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
const key = 'xiangqi:library:v1';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label); await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: width === 320 ? 480 : 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'source', savedAt: 1700000000000, gameMode: 'PvP', label: 'Cannon repertoire', moves: ['h2e2'],
            metadata: { event: 'Autumn' }, moveTree: [{ uci: 'h2e2', comment: 'Old note', children: [{ uci: 'h9g7' }] }, { uci: 'b2e2' }] },
          { id: 'other', savedAt: 1700000000001, gameMode: 'PvP', label: 'Other study', moves: ['b2e2'] },
        ])));
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
        await page.goto(base); await command(page, 'Library');
        await page.getByTestId('load-saved-source').click();
        const editNote = async value => {
          await command(page, 'Move tree');
          await page.getByTestId('move-comment-input').fill(value); await page.getByTestId('move-comment-input').blur();
        };
        const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
        await editNote('Prepared continuation 王'); await command(page, 'Update saved study');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).find(game => game.id === 'source').moveTree[0].comment === 'Prepared continuation 王', key);
        let games = await read(); assert.equal(games.length, 2);
        assert.equal(games[0].id, 'source'); assert.equal(games[0].savedAt, 1700000000000);
        assert.equal(games[0].label, 'Cannon repertoire');
        assert.equal(games[0].moveTree[0].children[0].uci, 'h9g7'); assert.equal(games[0].moveTree[1].uci, 'b2e2');
        assert.equal(games[0].metadata.event, 'Autumn');

        // A real second tab sends storage events, instead of manually dispatching them.
        const other = await page.context().newPage();
        await other.route('**/qa-storage.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Other library tab</title>' }));
        await other.goto(new URL('qa-storage.html', base).href);
        await other.evaluate(key => {
          const games = JSON.parse(localStorage.getItem(key)); games.find(game => game.id === 'source').label = 'Renamed elsewhere';
          games.push({ id: 'newer', savedAt: 1700000000002, gameMode: 'PvP', moves: ['h0g2'] });
          localStorage.setItem(key, JSON.stringify(games));
        }, key);
        await editNote('Second revision'); await command(page, 'Library');
        const update = page.getByTestId('update-saved-source'); await update.click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).find(game => game.id === 'source').moveTree[0].comment === 'Second revision', key);
        games = await read(); assert.equal(games.length, 3); assert.equal(games[0].label, 'Renamed elsewhere');
        await update.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/xiangqi-update-study-${browserType.name()}-${width}.png` });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

        await editNote('My unsaved revision');
        await other.evaluate(key => {
          const games = JSON.parse(localStorage.getItem(key)); games.find(game => game.id === 'source').moveTree[0].comment = 'Other tab revision';
          localStorage.setItem(key, JSON.stringify(games));
        }, key);
        const conflicting = await page.evaluate(key => localStorage.getItem(key), key);
        await command(page, 'Update saved study');
        await page.getByTestId('save-game-error').waitFor();
        assert.match(await page.getByTestId('save-game-error').innerText(), /changed since/);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), conflicting);
        await command(page, 'Move tree');
        assert.equal(await page.getByTestId('move-comment-input').inputValue(), 'My unsaved revision');
        await command(page, 'Save game');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).length === 4, key);
        games = await read(); const copy = games.find(game => !['source', 'other', 'newer'].includes(game.id));
        assert.equal(copy.moveTree[0].comment, 'My unsaved revision');
        assert.equal(games.find(game => game.id === 'source').moveTree[0].comment, 'Other tab revision');
        await other.evaluate(({ key, id }) => {
          const games = JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(games.filter(game => game.id !== id)));
        }, { key, id: copy.id });
        await command(page, 'Update saved study');
        assert.match(await page.getByTestId('save-game-error').innerText(), /no longer/);
        assert.equal((await read()).length, 3);

        await command(page, 'New game');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        for (const [file, rank] of [[7, 2], [4, 2]]) await page.locator(`.board-stage .hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Update saved study');
        await page.waitForFunction(() => document.querySelector('#command-update-saved-study')?.getAttribute('aria-disabled') === 'true', null, { timeout: 3000 });
        await page.keyboard.press('Escape');

        await command(page, 'Library'); await page.getByTestId('load-saved-source').click();
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('1. b2e2 b9c7 *');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Update saved study');
        await page.waitForFunction(() => document.querySelector('#command-update-saved-study')?.getAttribute('aria-disabled') === 'true', null, { timeout: 3000 });
        await page.keyboard.press('Escape');
        assert.equal((await read()).find(game => game.id === 'source').moveTree[0].comment, 'Other tab revision');
        await other.close(); assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: explicit updates preserve IDs/branches/names, real-tab changes merge or conflict, Save copies, deleted records stay deleted, new games and imports detach`);
      } finally { await page.context().close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
