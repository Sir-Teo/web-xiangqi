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
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const Native = Worker;
          window.__readerWorkers = { direct: [], collection: [] };
          window.Worker = function(url, options) {
            const kind = String(url).includes('directImport.worker') ? 'direct' : String(url).includes('pgnCollection.worker') ? 'collection' : null;
            if (!kind || window.__realReaders) return new Native(url, options);
            const worker = { postMessage() {}, terminate() { this.terminated = true; }, terminated: false };
            window.__readerWorkers[kind].push(worker); return worker;
          };
        });
        await page.goto(base + '?moves=b2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        const original = await page.locator('.bottombar-fen').getAttribute('title');
        await command(page, 'Import a game record');
        await page.getByTestId('uci-line-input').fill('h2e2 h9g7');
        const importButton = page.getByTestId('import-uci-line-btn');
        for (const data of [null, {}, { kind: 'text', text: 'Unexpected file response' },
          { kind: 'plan', plan: { kind: 'line', moves: ['h2e2'], notationRejected: [], dhtmlComments: [], flatMoveTree: [{ uci: 'h2e2', parent: 0 }] } }]) {
          await importButton.focus(); await importButton.press('Enter');
          assert.equal(await page.getByRole('alert').filter({ hasText: 'The game reader returned an unreadable response' }).count(), 0,
            'A retry clears the previous reader error while checking the game');
          await page.evaluate(data => window.__readerWorkers.direct.at(-1).onmessage({ data }), data);
          await page.getByRole('alert').filter({ hasText: 'The game reader returned an unreadable response' }).waitFor();
          assert.equal(await importButton.isEnabled(), true, 'Malformed direct replies must finish and allow retry');
          assert.equal(await importButton.evaluate(node => node === document.activeElement), true, 'Keyboard import failures retain focus for retry');
          assert.equal(await page.evaluate(() => window.__readerWorkers.direct.at(-1).terminated), true);
          await page.evaluate(() => window.__readerWorkers.direct.at(-1).onmessage({ data: null }));
          assert.equal(await page.getByRole('button', { name: 'Cancel reading', exact: true }).count(), 0);
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), original);
        }
        await importButton.press('Enter');
        await page.getByRole('button', { name: 'Cancel reading', exact: true }).focus();
        await page.evaluate(() => window.__readerWorkers.direct.at(-1).onmessageerror());
        await page.getByRole('alert').filter({ hasText: 'The game reader returned an unreadable response' }).waitFor();
        assert.equal(await importButton.evaluate(node => node === document.activeElement), true, 'An asynchronously removed Cancel control returns to Import');
        await importButton.press('Enter');
        const otherControl = page.locator('.new-game-menu-header').getByRole('button', { name: 'Close', exact: true }); await otherControl.focus();
        await page.evaluate(() => window.__readerWorkers.direct.at(-1).onmessage({ data: { error: 'Reader failure after focus moved' } }));
        await page.getByRole('alert').filter({ hasText: 'Reader failure after focus moved' }).waitFor();
        assert.equal(await otherControl.evaluate(node => node === document.activeElement), true, 'Completing a read must leave another focused control alone');
        const fileTrigger = page.getByTestId('load-uci-file-btn'); await fileTrigger.focus();
        const fileWorkerCount = await page.evaluate(() => window.__readerWorkers.direct.length);
        await page.getByTestId('uci-line-file-input').setInputFiles({ name: 'Direct.pgn', mimeType: 'text/plain', buffer: Buffer.from('h2e2 h9g7') });
        await page.getByRole('button', { name: 'Cancel reading', exact: true }).focus();
        await page.waitForFunction(count => window.__readerWorkers.direct.length === count + 1, fileWorkerCount);
        await page.evaluate(() => window.__readerWorkers.direct.at(-1).onmessage({ data: { kind: 'text', text: 'h2e2 h9g7' } }));
        await page.getByRole('button', { name: 'Cancel reading', exact: true }).waitFor({ state: 'hidden' });
        assert.equal(await fileTrigger.evaluate(node => node === document.activeElement), true, 'Decoded files return to the visible file control after Cancel disappears');
        await page.evaluate(() => { window.__realReaders = true; });
        await importButton.click();
        try {
          await page.waitForFunction(() => / w - - 2 2$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        } catch (error) {
          const state = await page.evaluate(() => ({ fen: document.querySelector('.bottombar-fen')?.title,
            alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
            busy: document.querySelector('[data-testid="import-uci-line-btn"]')?.textContent,
            input: document.querySelector('[data-testid="uci-line-input"]')?.value }));
          throw new Error(`Real reader retry failed at ${width}px: ${JSON.stringify(state)}`, { cause: error });
        }
        const afterImport = await page.locator('.bottombar-fen').getAttribute('title');
        assert.notEqual(afterImport, original, 'A real parser retry must load the requested game');
        await command(page, 'Library');
        const panel = page.getByTestId('pgn-collection-import'); await panel.locator('summary').click();
        const file = panel.getByLabel('Choose PGN collection');
        const library = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        await page.evaluate(() => { window.__realReaders = false; });
        async function upload() {
          const before = await page.evaluate(() => window.__readerWorkers.collection.length);
          await file.setInputFiles({ name: 'Retry.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from('[White "Retry player"]\n1.h2e2 *') });
          await page.waitForFunction(before => window.__readerWorkers.collection.length === before + 1, before);
        }
        for (const data of [null, { games: {} }, { games: [{}] }, { games: [{ gameMode: 'PvP', moves: ['h2e2'], flatMoveTree: [{ uci: 'h2e2', parent: 0 }] }] }]) {
          await upload();
          await panel.getByRole('button', { name: 'Cancel reading', exact: true }).focus();
          await page.evaluate(data => window.__readerWorkers.collection.at(-1).onmessage({ data }), data);
          await panel.getByRole('alert').filter({ hasText: 'The collection reader returned an unreadable response' }).waitFor();
          assert.equal(await page.evaluate(() => window.__readerWorkers.collection.at(-1).terminated), true);
          await page.evaluate(() => window.__readerWorkers.collection.at(-1).onmessage({ data: { games: [{ gameMode: 'PvP', moves: ['h2e2'] }] } }));
          assert.equal(await panel.locator('.lib-pgn-game').count(), 0, 'A late reply cannot replace a failed preview');
          assert.equal(await panel.getByRole('button', { name: 'Cancel reading', exact: true }).count(), 0);
          assert.equal(await file.evaluate(node => node === document.activeElement), true, 'Collection read failures return focus to the file chooser');
        }
        await upload(); await panel.getByRole('button', { name: 'Cancel reading', exact: true }).focus();
        await page.evaluate(() => window.__readerWorkers.collection.at(-1).onmessage({ data: { games: [{ gameMode: 'PvP', moves: ['h2e2'] }] } }));
        await panel.getByRole('button', { name: 'Import 1 game', exact: true }).waitFor();
        assert.equal(await file.evaluate(node => node === document.activeElement), true, 'Successful collection reads keep keyboard focus when Cancel disappears');
        await upload(); await panel.getByRole('button', { name: 'Cancel reading', exact: true }).focus();
        const summary = panel.locator('summary'); await summary.focus();
        await page.evaluate(() => window.__readerWorkers.collection.at(-1).onmessage({ data: { error: 'Reader failure after focus moved' } }));
        await panel.getByRole('alert').filter({ hasText: 'Reader failure after focus moved' }).waitFor();
        assert.equal(await summary.evaluate(node => node === document.activeElement), true, 'Collection completion must leave another focused control alone');
        await upload();
        const prevented = await page.evaluate(() => {
          const event = new ErrorEvent('error', { cancelable: true });
          window.__readerWorkers.collection.at(-1).onerror(event); return event.defaultPrevented;
        });
        assert.equal(prevented, true);
        await panel.getByRole('alert').filter({ hasText: 'The collection reader could not start' }).waitFor();
        await upload(); await page.evaluate(() => window.__readerWorkers.collection.at(-1).onmessageerror());
        await panel.getByRole('alert').filter({ hasText: 'The collection reader returned an unreadable response' }).waitFor();
        await page.evaluate(() => { window.__realReaders = true; });
        await file.setInputFiles({ name: 'Retry.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from('[White "Retry player"]\n1.h2e2 *') });
        await panel.getByRole('button', { name: 'Import 1 game', exact: true }).waitFor();
        assert.match(await panel.innerText(), /Retry player/);
        assert.equal(await panel.getByRole('alert').count(), 0, 'A real parser retry clears the earlier failure');
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), library, 'Bad replies and previews never write saved games');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), afterImport, 'Collection failures preserve the board');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: unreadable replies, cyclic trees, late replies, keyboard focus and real direct/collection retries passed`);
      } catch (error) {
        console.error('Reader recovery page errors:', JSON.stringify(errors));
        try {
          console.error('Reader recovery state:', JSON.stringify(await page.evaluate(() => ({
            view: document.querySelector('.app-shell')?.getAttribute('data-mobile-view'),
            dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.textContent?.slice(0, 120)),
            panel: (() => { const node = document.querySelector('.panel.left'); return node && { display: getComputedStyle(node).display, rect: node.getBoundingClientRect().toJSON() }; })(),
            text: document.body.innerText.slice(-1800),
          }))));
          await page.screenshot({ path: `/tmp/xiangqi-reader-recovery-${browserType.name()}-${width}-failure.png`, timeout: 5000 });
        } catch { /* Preserve the original failure if the page cannot respond. */ }
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
