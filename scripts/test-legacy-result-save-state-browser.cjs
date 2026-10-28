const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const base = { savedAt: 1, gameMode: 'PvP' };
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { ...base, id: 'red', label: 'Compact Red win', moves: ['h2e2', 'h9g7'], result: 'red', cursorPly: 0 },
            { ...base, id: 'black', label: 'Compact Black win', moves: ['h2e2'], result: 'black' },
            { ...base, id: 'draw', label: 'Compact draw', moves: ['h2e2'], result: 'draw' },
            { ...base, id: 'root', label: 'Legacy diagram', moves: [], result: 'draw', metadata: { event: 'Diagram' } },
            { ...base, id: 'branch', label: 'Pinned repertoire', moves: ['b2e2', 'h9g7'], result: 'red', mainLinePinned: true, cursorPly: 0,
              moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }, { uci: 'b2e2', children: [{ uci: 'h9g7' }] }] },
            { ...base, id: 'prefix', label: 'Draw with continuation', moves: ['h2e2'], result: 'draw',
              moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }] },
            { ...base, id: 'explicit-node', label: 'Explicit move result', moves: ['h2e2'], result: 'red',
              moveTree: [{ uci: 'h2e2', recordedResult: 'red-wins' }] },
            { ...base, id: 'explicit-root', label: 'Explicit diagram result', moves: [], result: 'draw', rootResult: 'draw', metadata: { event: 'Diagram' } },
          ]));
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
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const status = page.getByTestId('study-save-status');
        const raw = () => page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="study-save-status"]')?.textContent.includes('Saved study'));
        for (const id of ['red', 'black', 'draw', 'root', 'branch', 'prefix', 'explicit-node', 'explicit-root']) {
          const before = await raw();
          await page.getByTestId(`load-saved-${id}`).click();
          await waitSaved();
          assert.equal(await raw(), before, `Loading ${id} must not rewrite its legacy representation`);
          if (await page.locator('.game-over-modal').count()) {
            await page.keyboard.press('Escape');
            await page.locator('.game-over-modal').waitFor({ state: 'hidden' });
          }
          await command(page, 'Move tree');
          await waitSaved();
          const metadata = page.getByTestId('game-metadata');
          if (await metadata.getAttribute('open') === null) await metadata.locator('summary').click();
          const event = metadata.getByLabel('Event', { exact: true });
          const original = await event.inputValue();
          await event.fill('Edited ' + id);
          assert.match(await status.textContent(), /Modified study/);
          await event.fill(original);
          await waitSaved();
          assert.equal(await raw(), before, 'Editing and reverting details must preserve the original saved record');
          await event.fill('Edited ' + id);
          await page.keyboard.press('ControlOrMeta+s');
          await waitSaved();
          const saved = await page.evaluate(id => {
            const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
            return { count: games.length, game: games.find(game => game.id === id) };
          }, id);
          assert.equal(saved.count, 8);
          assert.equal(saved.game.metadata.event, 'Edited ' + id);
          if (id === 'root' || id === 'explicit-root') assert.equal(saved.game.rootResult, 'draw');
          if (id === 'branch') {
            assert.equal(saved.game.moveTree[0].children[0].recordedResult, undefined);
            assert.equal(saved.game.moveTree[1].children[0].recordedResult, 'red-wins');
          }
          if (id === 'prefix') {
            assert.equal(saved.game.moveTree[0].recordedResult, 'draw');
            assert.equal(saved.game.moveTree[0].children[0].recordedResult, undefined);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await command(page, 'Library');
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: legacy/explicit root and move outcomes load as Saved; edit/revert, exact-branch result placement and same-ID saves passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
