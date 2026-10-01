const assert = require('node:assert/strict');
const path = require('node:path');
const { browserType } = require('./qa-browser.cjs');
const { loadPikafishNode } = require('./load-pikafish-node.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const blackCycle = ['e0f0', 'e8f8', 'f0e0', 'f8e8'];
const repeated = (cycle, count) => Array.from({ length: count }, (_, i) => cycle[i % cycle.length]);
const fixtures = [
  { id: 'black-checks', startFen: '3k5/4r4/9/9/9/9/9/9/9/4K4 w - - 0 1', moves: repeated(blackCycle, 64) },
  { id: 'red-checks', startFen: '4k4/9/9/9/9/9/9/9/4R4/3K5 b - - 37 42', moves: repeated(['e9f9', 'e1f1', 'f9e9', 'f1e1'], 24) },
  { id: 'quiet-after-checks', startFen: '3k5/4r4/9/9/9/9/9/9/9/4K4 w - - 0 1', moves: [...repeated(blackCycle, 24), 'e0f0', 'e8e7', 'f0f1', 'e7e8'] },
  { id: 'capture-reset', startFen: '3k5/4r4/9/9/9/3p5/9/9/9/3nK4 w - - 89 1', moves: [...repeated(blackCycle, 24), 'e0d0', 'e8e7', 'd0d1', 'e7e8', 'd1d0'] },
  { id: 'notice-count', startFen: '3k5/4r4/9/9/9/9/9/9/9/4K4 w - - 69 1', moves: repeated(blackCycle, 24) },
  { id: 'notice-limit', startFen: '3k5/4r4/9/9/9/9/9/9/9/4K4 w - - 100 1', moves: repeated(blackCycle, 24) },
];
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
};
async function engineFens() {
  const dist = path.resolve(__dirname, '../dist');
  const pikafish = loadPikafishNode(dist, 'single-simd', 'rule60-parity');
  const engine = await pikafish.createPikafish({ basePath: dist, nnuePath: path.join(dist, 'pikafish.nnue'),
    variant: pikafish.variant, coreFactory: pikafish.coreFactory, allowSIMD: true, autoTune: false });
  const results = new Map();
  try {
    await engine.uci({ timeoutMs: 20000 }); await engine.isReady({ timeoutMs: 20000 });
    for (const fixture of fixtures) {
      const fens = [];
      for (let ply = 0; ply <= fixture.moves.length; ply++) {
        engine.postMessage(`position fen ${fixture.startFen}${ply ? ' moves ' + fixture.moves.slice(0, ply).join(' ') : ''}`);
        const answer = engine.waitForLine(/^Fen:/, { timeoutMs: 10000, fresh: true });
        engine.postMessage('d'); fens.push((await answer).slice(5));
        const rootFields = fixture.startFen.split(' ');
        assert.equal(fens.at(-1).split(' ')[1], ply % 2 ? (rootFields[1] === 'w' ? 'b' : 'w') : rootFields[1], `${fixture.id}: engine must accept the side at ply ${ply}`);
        assert.equal(Number(fens.at(-1).split(' ')[5]), Number(rootFields[5]) + Math.floor((ply + (rootFields[1] === 'b' ? 1 : 0)) / 2), `${fixture.id}: engine must accept ply ${ply}`);
      }
      results.set(fixture.id, fens);
    }
  } finally { await engine.terminate(); }
  assert.equal(results.get('black-checks')[24].split(' ')[4], '21', 'The reference must exercise extended-check discounting');
  assert.equal(results.get('capture-reset')[25].split(' ')[4], '0');
  return results;
}
(async () => {
  const expected = await engineFens();
  const browser = await browserType.launch();
  try {
    for (const width of (process.env.XIANGQI_QA_WIDTH ? [Number(process.env.XIANGQI_QA_WIDTH)] : [1440, 390, 320])) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(games => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
        }, fixtures.map(fixture => ({ ...fixture, label: fixture.id, savedAt: 1, gameMode: 'PvP' })));
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
        await page.locator('.xiangqi-board').waitFor();
        if (await page.getByTestId('start-engine-analysis').isVisible()) await page.getByTestId('start-engine-analysis').click();
        for (const fixture of fixtures) {
          await command(page, 'Library'); await page.getByTestId('load-saved-' + fixture.id).click();
          if (width < 900) await page.getByTestId('mobile-view-board').click();
          const fens = expected.get(fixture.id);
          assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fens.at(-1), fixture.id);
          // Compare every prefix, including the 10th/11th check and a capture.
          for (let ply = fixture.moves.length - 1; ply >= 0; ply--) {
            await page.locator('button[aria-label="Go to previous move"]:visible').first().click();
            assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fens[ply], `${fixture.id} ply ${ply}`);
          }
          await command(page, 'Go to latest move');
          await command(page, 'Copy FEN');
          assert.equal(await page.evaluate(() => window.__copied), fens.at(-1), 'Exported FEN must match the engine');
          const notice = page.getByTestId('capture-free-notice');
          if (fixture.id === 'black-checks') assert.equal(await notice.count(), 0, '64 raw plies must not trigger a false 30-counted-move notice');
          if (fixture.id === 'notice-count' || fixture.id === 'notice-limit') {
            assert.match(await notice.innerText(), /counted moves without a capture/);
            if (fixture.id === 'notice-count') assert.match(await notice.innerText(), /45 counted moves.*15 moves left[\s\S]*Extended checking sequences/s);
            else assert.match(await notice.innerText(), /mate and repetition rulings take precedence/);
            await command(page, 'Settings');
            await page.getByRole('button', { name: 'Pro interface, compact analysis with fewer teaching prompts', exact: true }).click();
            await page.getByRole('button', { name: 'Close settings', exact: true }).click();
            for (const size of [16, 32]) {
              await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
              const explanation = notice.locator('em');
              await explanation.waitFor({ state: 'visible' });
              await page.waitForFunction(size => Math.abs(parseFloat(getComputedStyle(document.querySelector('[data-testid="capture-free-notice"] em')).fontSize) - size * .54) < .1, size);
              await explanation.evaluate(node => node.scrollIntoView({ block: 'center' }));
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              await explanation.evaluate(node => node.scrollIntoView({ block: 'center' }));
              await page.waitForFunction(() => { const node = document.querySelector('[data-testid="capture-free-notice"] em'); const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
              assert.equal(await explanation.evaluate(node => node.scrollHeight <= node.clientHeight + 1), true, 'The complete explanation must remain readable in Pro mode');
              assert.equal(await notice.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              await page.screenshot({ path: `/tmp/xiangqi-rule60-${browserType.name()}-${width}-${fixture.id}-${size}.png` });
            }
            await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
          }
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: all prefix FENs match real Pikafish for both checking sides, capture resets, quiet replies and custom roots; exported clocks and 100/200% notices passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
