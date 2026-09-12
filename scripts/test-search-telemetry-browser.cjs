const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label); await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 900 }, reducedMotion: 'reduce' });
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__commands = [];
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line)); window.__emit = emit;
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              window.__commands.push(command);
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') && !window.__hold) queueMicrotask(() => { emit('info depth 8 score cp 30 pv h2e2'); emit('bestmove h2e2'); });
              if (command === 'stop') queueMicrotask(() => emit('bestmove h2e2'));
            } };
          };` }));
        await page.goto(base); await command(page, 'Engine panel');
        const status = page.getByTestId('engine-search-status');
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-search-status"]')?.textContent === 'D8');
        const card = status.locator('..');
        await page.getByTestId('deep-infinite-toggle').click();
        await page.evaluate(() => { window.__hold = true; });
        await page.getByTestId('deep-dive-btn').click();
        await page.waitForFunction(() => window.__commands.includes('go infinite'));
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-search-status"]')?.textContent === 'Pending');
        assert.doesNotMatch(await card.innerText(), /target D|\d+ms|primary/, 'An unlimited search must not show the short live-analysis budget');
        await page.evaluate(() => window.__emit('info nodes 99 nps 12000 hashfull 0'));
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-search-status"]')?.parentElement.textContent.includes('12k nps'));
        assert.equal(await status.innerText(), 'Pending', 'Node counts do not prove a completed depth');
        assert.doesNotMatch(await card.getAttribute('aria-label'), /D\d/);
        await page.evaluate(() => window.__emit('info seldepth 27'));
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-search-status"]')?.textContent === 'S27');
        await page.evaluate(() => window.__emit('info depth 12 nodes 30000 nps 250000 hashfull 12 time 120 score cp 30 pv h2e2'));
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-search-status"]')?.textContent === 'D12/S27');
        assert.match(await card.getAttribute('aria-label'), /30k nodes.*250k nps.*hash 1%.*120ms/);
        await page.getByTestId('deep-dive-btn').click();
        assert.equal(await status.innerText(), 'D12/S27');

        await page.getByTestId('deep-infinite-toggle').click();
        const count = await page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length);
        await page.getByTestId('deep-dive-btn').click();
        await page.waitForFunction(count => window.__commands.filter(command => command.startsWith('go ')).length > count, count);
        await page.evaluate(() => window.__emit('info nodes 123'));
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-search-status"]')?.parentElement.textContent.includes('123 nodes'));
        assert.equal(await status.innerText(), 'Pending');
        await page.getByTestId('deep-dive-btn').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-search-status"]')?.textContent === 'No depth');
        await card.scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-search-telemetry-${browserType.name()}-${width}.png` });
        console.log(`${browserType.name()} ${width}px: missing depth stays unknown, selective depth is independent, measured stats survive Stop and infinite search has no invented time limit`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
