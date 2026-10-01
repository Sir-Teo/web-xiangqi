const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(Array.from({ length: 150 }, (_, i) => ({
            id: `focus-${i}`, savedAt: i + 1, gameMode: 'PvP', label: i === 18 ? 'Needle focus study' : `Study ${i}`, moves: ['h2e2'],
          }))));
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
        if (width < 900) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-library').click();
        } else await page.getByRole('button', { name: 'Open game library', exact: true }).click();
        const list = page.getByTestId('saved-game-list');
        const card = id => page.getByTestId(`load-saved-focus-${id}`).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," lib-card ")][1]');
        const name = id => card(id).locator('.lib-game-name-button');
        const focused = async locator => page.waitForFunction(element => element === document.activeElement,
          await locator.elementHandle(), { timeout: 3000 });
        await page.getByTestId('library-show-more-saved').click();
        await page.getByTestId('load-saved-focus-0').waitFor();
        await name(20).click();
        await card(20).getByRole('textbox').fill('Renamed study');
        await card(20).getByRole('textbox').press('Enter');
        await focused(name(20));
        assert.equal(await name(20).innerText(), 'Renamed study');
        await page.screenshot({ path: `/tmp/xiangqi-library-edit-focus-${browserType.name()}-${width}.png` });
        await name(20).click();
        await card(20).getByRole('textbox').fill('Discard this');
        await card(20).getByRole('textbox').press('Escape');
        await focused(name(20));
        assert.equal(await name(20).innerText(), 'Renamed study');
        await page.getByTestId('delete-saved-focus-20').click();
        await focused(page.getByTestId('confirm-delete-saved-focus-20'));
        await page.getByTestId('cancel-delete-saved-focus-20').click();
        await focused(page.getByTestId('delete-saved-focus-20'));
        await page.getByTestId('delete-saved-focus-20').press('Enter');
        await page.getByTestId('confirm-delete-saved-focus-20').press('Enter');
        await focused(page.getByTestId('load-saved-focus-149'));
        assert.equal(await list.locator('.lib-card').count(), 149, 'Deleting must retain the expanded page');
        await page.getByTestId('load-saved-focus-149').press('ArrowDown');
        await focused(page.getByTestId('load-saved-focus-148'));
        await page.getByTestId('delete-saved-focus-0').click();
        await page.getByTestId('confirm-delete-saved-focus-0').press('Enter');
        await focused(page.getByTestId('load-saved-focus-1'));
        assert.equal(await list.locator('.lib-card').count(), 148, 'The last card returns focus to its preceding neighbor');

        // Failed writes retain the editor and its focus, allowing a retry.
        await page.evaluate(() => {
          window.__originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key === 'xiangqi:library:v1') throw new Error('QA quota');
            return window.__originalSetItem.call(this, key, value);
          };
        });
        await name(18).click();
        await card(18).getByRole('textbox').fill('Failed rename');
        await card(18).getByRole('textbox').press('Enter');
        await page.getByText('Could not rename this game.', { exact: false }).waitFor();
        await focused(card(18).getByRole('textbox'));
        await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
        await page.getByTestId('cancel-rename-saved-focus-18').click();
        await focused(name(18));

        // If a successful rename removes the only matching card, return to search.
        const search = page.getByRole('searchbox', { name: 'Search library' });
        await search.fill('Needle focus study');
        await name(18).click();
        await card(18).getByRole('textbox').fill('Other opening');
        await card(18).getByRole('textbox').press('Enter');
        await focused(search);
        assert.equal(await list.locator('.lib-card').count(), 0);
        await search.fill('Other opening');
        await page.getByTestId('delete-saved-focus-18').click();
        await page.getByTestId('confirm-delete-saved-focus-18').press('Enter');
        await focused(search);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).length), 147);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: rename/save/cancel/Escape, deletion neighbors, expanded pages, failed-write focus and filtered-empty recovery passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
