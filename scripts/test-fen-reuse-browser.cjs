"use strict";
const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const start = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
const capture = '4k4/9/9/9/4p4/9/9/9/4R4/3K5';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function counters(page, halfmove, fullmove, side) {
  await page.waitForFunction(expected => {
    const fen = document.querySelector('.bottombar-fen')?.getAttribute('title')?.split(' ');
    return fen?.[1] === expected.side && Number(fen[4]) === expected.halfmove && Number(fen[5]) === expected.fullmove;
  }, { halfmove, fullmove, side });
  return page.locator('.bottombar-fen').getAttribute('title');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(({ start, capture }) => {
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'long-fen', savedAt: 1, gameMode: 'PvP', startFen: start + ' w - - 45 20',
              moves: Array.from({ length: 1024 }, (_, i) => cycle[i % 4]) },
            { id: 'red-capture', savedAt: 2, gameMode: 'PvP', startFen: capture + ' w - - 45 20', moves: ['e1e5', 'e9f9'] },
            { id: 'black-capture', savedAt: 3, gameMode: 'PvP', startFen: capture + ' b - - 45 20', moves: ['e9f9', 'e1e5'] },
          ]));
          window.__pathEntries = 0;
          for (const method of ['push', 'unshift']) {
            const original = Array.prototype[method];
            Array.prototype[method] = function(...items) {
              if (items.length === 1 && typeof items[0] === 'string' && /^n\d+$/.test(items[0])) window.__pathEntries++;
              return Reflect.apply(original, this, items);
            };
          }
        }, { start, capture });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: fn => listeners.push(fn), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base);
        await page.locator('.board-stage .xiangqi-board').waitFor();
        const load = async id => {
          await command(page, 'Library');
          await page.getByTestId('load-saved-' + id).click();
          if (width < 900) await page.getByTestId('mobile-view-board').click();
        };
        await load('long-fen');
        const originalFen = await counters(page, 1069, 532, 'w');
        assert.equal(originalFen, start + ' w - - 1069 532');
        const board = page.locator('.board-stage .xiangqi-board-container');
        let orientation = await board.getAttribute('data-orientation');
        await page.evaluate(() => { document.activeElement?.blur(); window.__pathEntries = 0; });
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('f');
          orientation = orientation === 'red' ? 'black' : 'red';
          await page.waitForFunction(orientation => document.querySelector('.board-stage .xiangqi-board-container')?.getAttribute('data-orientation') === orientation, orientation);
        }
        const entries = await page.evaluate(() => window.__pathEntries);
        console.log(`${browserType.name()} ${width}px: node IDs inserted into paths during ten board flips = ${entries}`);
        assert.equal(entries, 0, 'Unchanged positions must not rebuild ancestry paths on unrelated renders');
        assert.equal(await counters(page, 1069, 532, 'w'), originalFen);
        await page.locator('button[aria-label="Go to previous move"]:visible').first().click();
        await counters(page, 1068, 531, 'b');
        await page.locator('button[aria-label="Go to next move"]:visible').first().click();
        assert.equal(await counters(page, 1069, 532, 'w'), originalFen);

        for (const black of [false, true]) {
          await load(black ? 'black-capture' : 'red-capture');
          await counters(page, black ? 0 : 1, 21, black ? 'b' : 'w');
          await page.locator('button[aria-label="Go to previous move"]:visible').first().click();
          await counters(page, black ? 46 : 0, black ? 21 : 20, black ? 'w' : 'b');
          await page.locator('button[aria-label="Go to previous move"]:visible').first().click();
          assert.equal(await counters(page, 45, 20, black ? 'b' : 'w'), capture + ` ${black ? 'b' : 'w'} - - 45 20`);
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: long-history FEN, navigation, capture clocks and Black roots pass`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
