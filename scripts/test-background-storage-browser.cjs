const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k'); await page.getByRole('combobox', { name: 'Search commands' }).fill(label); await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const records = Array.from({ length: 150 }, (_, i) => ({ id: `saved-${i}`, savedAt: i, gameMode: 'PvP', moves: ['h2e2'], result: 'ongoing', label: 'Old saved study ' + i,
        rootComment: 'a'.repeat(600), moveTree: [{ uci: 'h2e2', comment: 'Retained cannon note' }] }));
      localStorage.setItem('xiangqi:library:v1', JSON.stringify(records));
      localStorage.setItem('xiangqi:preferences:v1', JSON.stringify({ soundEnabled: false }));
      const NativeWorker = Worker;
      window.__reads = []; window.__saves = [];
      window.Worker = function(url, options) {
        const type = String(url).includes('libraryRead.worker') ? 'read' : String(url).includes('autoSave.worker') ? 'save' : null;
        const native = new NativeWorker(url, options);
        if (!type) return native;
        const facade = { onmessage: null, onerror: null, onmessageerror: null, terminated: false,
          postMessage: data => native.postMessage(data), terminate() { this.terminated = true; native.terminate(); } };
        native.onmessage = event => {
          const entry = { facade, data: event.data, deliver: () => facade.onmessage?.({ data: event.data }) };
          (type === 'read' ? window.__reads : window.__saves).push(entry);
        };
        native.onerror = event => facade.onerror?.(event);
        native.onmessageerror = event => facade.onmessageerror?.(event);
        return facade;
      };
    });
    const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
    await page.goto(base + '?moves=' + Array.from({ length: 256 }, (_, i) => cycle[i % 4]).join('+'));
    await page.waitForFunction(() => window.__reads.length === 1);
    await command(page, 'Library');
    await page.getByText('Loading saved games…', { exact: true }).waitFor();
    await page.locator('.hitbox[data-file="0"][data-rank="0"]').click();
    assert.equal(await page.locator('.piece.selected').count(), 1, 'Library parsing blocked board input');
    await page.evaluate(() => window.__reads[0].deliver());
    await page.getByText('Old saved study 149', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).length), 150);
    await command(page, 'Move tree');
    await page.getByTestId('move-comment-input').fill('Initial annotation');
    await page.getByTestId('move-comment-input').blur();
    await page.waitForFunction(() => window.__saves.length > 0);
    // A close/background event must synchronously flush newer edits and cancel
    // an older prepared snapshot, even before the debounced worker runs again.
    await page.getByTestId('move-comment-input').fill('Latest note before backgrounding');
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    const latest = await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1'));
    assert.ok(latest.includes('Latest note before backgrounding'));
    assert.equal(await page.evaluate(() => window.__saves[0].facade.terminated), true);
    await page.evaluate(() => window.__saves[0].deliver());
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1')), latest, 'Late preparation overwrote the close-time save');
    assert.deepEqual(errors, []);
    await page.close();
    // Hold another initial read, then publish newer bytes through a storage
    // event. An obsolete result cannot resurrect deleted/renamed records.
    const stale = await browser.newPage();
    await stale.addInitScript(() => {
      localStorage.setItem('xiangqi:library:v1', JSON.stringify(Array.from({ length: 150 }, (_, i) => ({ id: 'old-' + i, savedAt: i, gameMode: 'PvP', moves: ['h2e2'], rootComment: 'x'.repeat(600) }))));
      const NativeWorker = Worker;
      window.Worker = function(url, options) {
        if (!String(url).includes('libraryRead.worker')) return new NativeWorker(url, options);
        const worker = { terminate() { window.__readCancelled = true; }, postMessage() {}, onmessage: null };
        window.__heldRead = worker; return worker;
      };
    });
    await stale.goto(base); await stale.waitForFunction(() => window.__heldRead);
    await stale.evaluate(() => {
      localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'new', savedAt: 200, gameMode: 'PvP', moves: ['b2e2'], label: 'Newer tab study' }]));
      dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
    });
    await command(stale, 'Library');
    await stale.getByText('Newer tab study', { exact: true }).waitFor();
    await stale.evaluate(() => window.__heldRead.onmessage({ data: { games: [], mutationBlocked: false } }));
    assert.equal(await stale.getByText('Newer tab study', { exact: true }).count(), 1);
    assert.equal(await stale.evaluate(() => window.__readCancelled), true);
    await stale.close();
    console.log(`${browserType.name()}: background library read, live board input, annotations, close-time flush and stale library/autosave replies passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
