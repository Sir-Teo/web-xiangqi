const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const prefix = Array.from({ length: 1000 }, (_, i) => ['a0a1', 'a9a8', 'a1a0', 'a8a9'][i % 4]);
const tail = Array.from({ length: 20 }, (_, i) => ['a9a8', 'a0a1', 'a8a9', 'a1a0'][i % 4]);
const moves = [...prefix, 'h2h9', ...tail];
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(moves => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'capture-clock', label: 'Capture clock', savedAt: 1, gameMode: 'PvP', moves },
            { id: 'black-clock', label: 'Custom Black clock', savedAt: 2, gameMode: 'PvP',
              startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 37 42',
              moves: ['a9a8', 'a0a1', 'a8a9', 'a1a0', 'h7h0'] },
          ]));
          const reverse = Array.prototype.reverse;
          window.__ancestorEntries = 0;
          Array.prototype.reverse = function() {
            if (typeof this[0] === 'string' && /^n\d+$/.test(this[0])) window.__ancestorEntries += this.length;
            return Reflect.apply(reverse, this, []);
          };
        }, moves);
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('position ')) window.__enginePosition = command;
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        const load = async id => {
          await command(page, 'Library'); await page.getByTestId('load-saved-' + id).click();
          if (width < 900) await page.getByTestId('mobile-view-board').click();
        };
        const atClock = async (clock, fullmove) => {
          await page.waitForFunction(({ clock, fullmove }) => {
            const fields = document.querySelector('.bottombar-fen')?.getAttribute('title')?.split(' ');
            return Number(fields?.[4]) === clock && (fullmove === undefined || Number(fields?.[5]) === fullmove);
          }, { clock, fullmove });
        };
        const previous = async () => page.locator('button[aria-label="Go to previous move"]:visible').first().click();
        await load('capture-clock'); await atClock(20);
        await page.evaluate(() => { window.__ancestorEntries = 0; });
        for (let clock = 19; clock >= 10; clock--) { await previous(); await atClock(clock); }
        const entries = await page.evaluate(() => window.__ancestorEntries);
        console.log(`${browserType.name()} ${width}px: reversed ancestor entries across ten post-capture board steps = ${entries}`);
        if (process.env.XIANGQI_QA_MEASURE_ONLY) continue;
        assert.equal(entries, 0, 'The clock must not allocate/reverse the full ancestry after a recent capture');
        for (let clock = 9; clock >= 0; clock--) { await previous(); await atClock(clock); }
        assert.equal(await page.getByTestId('capture-free-notice').count(), 0);
        await previous(); await atClock(1000);
        await page.getByTestId('capture-free-notice').waitFor();
        await command(page, 'Go to latest move'); await atClock(20);
        await page.waitForFunction(expected => window.__enginePosition === 'position startpos moves ' + expected, moves.join(' '));
        await command(page, 'Save game');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.deepEqual(saved.moves, moves, 'Saving must keep the history before the capture');
        await load('black-clock'); await atClock(0, 45);
        await previous(); await atClock(41, 44);
        await command(page, 'Go to start'); await atClock(37, 42);
        await command(page, 'Go to latest move'); await atClock(0, 45);
        await page.waitForFunction(() => window.__enginePosition === 'position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 37 42 moves a9a8 a0a1 a8a9 a1a0 h7h0');
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.locator(width < 900 ? '.position-stat-turn' : '.bottombar-fen').scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          await page.screenshot({ path: `/tmp/xiangqi-halfmove-clock-${browserType.name()}-${width}-${size}.png` });
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
