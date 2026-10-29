const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const engine = `
window.__commands = [];
window.Pikafish = function() {};
window.Pikafish.createWorkerEngine = async () => {
  const listeners = [];
  window.__emit = line => listeners.forEach(listener => listener(line));
  return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
    window.__commands.push(command);
    if (command === 'uci') queueMicrotask(() => window.__emit('uciok'));
    if (command === 'isready') queueMicrotask(() => window.__emit('readyok'));
  } };
};`;
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function emit(page, move, score, bound = '') {
  await page.evaluate(({ move, score, bound }) => {
    window.__emit(`info depth 18 multipv 1 score cp ${score}${bound} nodes 10000 nps 200000 time 50 pv ${move}`);
    window.__emit(`bestmove ${move}`);
  }, { move, score, bound });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
          Object.defineProperty(document, 'hidden', { get: () => false });
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: engine }));
        await page.clock.install();
        await page.goto(base + '?moves=h2e2+h9g7+h0g2');
        await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => window.__commands?.some(command => command.startsWith('go ')));
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
        const searches = () => page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length);
        const navigate = async direction => {
          await page.locator(`button[aria-label="Go to ${direction} move"]:visible`).first().click();
          await page.clock.runFor(400);
        };
        const evaluation = width < 900 ? page.locator('.mobile-eval-chip') : page.getByTestId('eval-bar');
        await emit(page, 'a9a8', 27);
        await navigate('previous');
        assert.equal(await searches(), 2);
        await emit(page, 'a0a1', 42);
        await page.locator('button[aria-label="Go to next move"]:visible').first().click();
        assert.equal(await searches(), 2, 'Revisiting a completed automatic search must not send go');
        // The clock remains paused: reuse must bypass the live-search debounce.
        assert.equal((await evaluation.textContent()).trim(), '-0.3');
        await navigate('previous');
        assert.equal(await searches(), 2);
        assert.equal((await evaluation.textContent()).trim(), '+0.4');

        // An interrupted search may have an exact score but is not a completed answer.
        await navigate('previous');
        assert.equal(await searches(), 3);
        await page.evaluate(() => window.__emit('info depth 6 multipv 1 score cp 90 pv a9a8'));
        await navigate('next');
        assert.equal(await searches(), 3, 'Cache hit must still wait for the old engine to acknowledge stop');
        assert.equal(await page.evaluate(() => window.__commands.at(-1)), 'stop');
        await page.evaluate(() => window.__emit('bestmove a9a8'));
        await page.clock.runFor(50);
        assert.equal(await searches(), 3);
        await navigate('previous');
        assert.equal(await searches(), 4, 'Stopped searches must not enter the cache');
        await emit(page, 'a9a8', 90, ' lowerbound');
        await navigate('next');
        await navigate('previous');
        assert.equal(await searches(), 5, 'Bound-only searches must not enter the cache');
        await emit(page, 'a9a8', 91);

        await command(page, 'Clear engine hash');
        await page.clock.runFor(400);
        const afterClear = await searches();
        await navigate('next');
        assert.equal(await searches(), afterClear + 1, 'Option changes must discard cached positions');
        await emit(page, 'a0a1', 43);
        await command(page, 'Restart engine');
        await page.clock.runFor(500);
        await emit(page, 'a0a1', 44);
        const afterRestart = await searches();
        await navigate('previous');
        assert.equal(await searches(), afterRestart + 1, 'Worker replacement must discard cached positions');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: automatic reuse, scores, stop acknowledgement, bounds, options and worker replacement passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
