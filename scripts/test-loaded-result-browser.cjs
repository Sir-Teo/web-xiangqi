const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const redFen = '4k4/1R7/9/9/9/9/9/9/R8/3K5 w - - 0 1';
const fixtures = [
  { id: 'mate-line', startFen: redFen, moves: ['a1a9'], result: 'ongoing', expected: 'Red Wins', tag: '1-0', saved: 'red' },
  { id: 'mate-tree', startFen: redFen, moves: ['a1a9'], moveTree: [{ uci: 'a1a9' }, { uci: 'a1a2' }], result: 'draw', expected: 'Red Wins', tag: '1-0', saved: 'red' },
  { id: 'black-mate', startFen: '3k5/r8/9/9/9/9/9/9/1r7/4K4 b - - 0 1', moves: ['a8a0'], result: 'red', expected: 'Black Wins', tag: '0-1', saved: 'black' },
  { id: 'stalemate-root', startFen: '3k5/4R4/9/9/9/9/9/9/9/4K4 b - - 0 1', moves: [], result: 'draw', expected: 'Red Wins', tag: '1-0', saved: 'red' },
  { id: 'agreed-draw', moves: ['h2e2'], result: 'draw', expected: 'Draw', tag: '1/2-1/2', saved: 'draw' },
  { id: 'resignation-tree', moves: ['h2e2'], moveTree: [{ uci: 'h2e2' }, { uci: 'b2e2' }], result: 'black', expected: 'Black Wins', tag: '0-1', saved: 'black' },
];
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function copyPgn(page) { await command(page, 'Copy PGN'); return page.evaluate(() => window.__copied); }
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : width === 390 ? 844 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(fixtures => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(fixtures.map((game, index) => ({ ...game, gameMode: 'PvP', savedAt: index + 1 }))));
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
        }, fixtures);
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
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        for (const fixture of fixtures) {
          await command(page, 'Library');
          await page.getByTestId(`load-saved-${fixture.id}`).click();
          const modal = page.getByRole('dialog', { name: fixture.expected, exact: true });
          await modal.waitFor({ timeout: 3000 });
          if (fixture.id === 'stalemate-root') assert.match(await modal.innerText(), /no legal moves/i);
          if (fixture.id === 'mate-tree') await page.screenshot({ path: `/tmp/xiangqi-loaded-result-${browserType.name()}-${width}.png` });
          await modal.getByRole('button', { name: 'Review', exact: true }).click();
          assert.ok((await copyPgn(page)).includes(`[Result "${fixture.tag}"]`), fixture.id);
          {
            const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
            await command(page, 'Save game');
            await page.waitForFunction(before => localStorage.getItem('xiangqi:library:v1') !== before, before);
          }
          const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
          assert.equal(saved.result, fixture.saved, fixture.id);
          if (fixture.moves.length) {
            await command(page, 'Go to start');
            assert.equal(await page.locator('.game-over-modal').count(), 0);
          }
        }
        // Seed recovery before the app mounts: pagehide intentionally flushes
        // the previous live study, so seeding before reload would be overwritten.
        await page.addInitScript(game => localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({ version: 1, savedAt: Date.now(), game: { ...game, id: 'auto-save', gameMode: 'PvP', savedAt: Date.now() } })), fixtures[0]);
        await page.reload();
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.getByRole('dialog', { name: 'Red Wins', exact: true }).waitFor({ timeout: 3000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: terminal line/tree/root outcomes override stale results; agreed draws/resignations, navigation, export, saving and recovery passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
