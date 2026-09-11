const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function setHidden(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await page.waitForTimeout(120);
}

async function check(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.__commands = []; window.__boots = 0; window.__deepStarts = 0;
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        window.__boots++;
        const listeners = [];
        const emit = line => listeners.forEach(listener => listener(line));
        let position = '', deep = false;
        window.__finishDeep = () => {
          if (!deep) throw new Error('No deep search is running');
          emit('info depth 28 multipv 1 score cp 120 wdl 700 200 100 pv b9c7 a0a1');
          deep = false; emit('bestmove b9c7');
        };
        return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
          postMessage(command) {
            window.__commands.push(command);
            if (command.startsWith('position ')) position = command;
            if (command === 'uci') queueMicrotask(() => emit('uciok'));
            if (command === 'isready') queueMicrotask(() => emit('readyok'));
            if (command.startsWith('go ')) queueMicrotask(() => {
              if (window.__nextDeep) {
                window.__nextDeep = false; deep = true; window.__deepStarts++;
                emit('info depth 20 multipv 1 score cp 100 wdl 600 300 100 pv b9c7 a0a1');
              } else {
                const move = position === 'position startpos moves h2e2' ? 'h9g7' : 'a0a1';
                emit('info depth 8 multipv 1 score cp 30 pv ' + move); emit('bestmove ' + move);
              }
            });
            if (command === 'stop') queueMicrotask(() => { deep = false; emit('bestmove b9c7'); });
          }
        };
      };
    ` }));
    await page.goto(base + '?moves=h2e2');
    await page.keyboard.press('e');
    const pv = page.getByTestId('engine-pv-line-0');
    const waitDepth = depth => page.waitForFunction(value => document.querySelector('[data-testid="engine-pv-line-0"]')?.getAttribute('aria-label').includes(`depth ${value},`), depth);
    const goCount = () => page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length);
    const startDeep = async () => {
      const count = await page.evaluate(() => window.__deepStarts);
      await page.evaluate(() => { window.__nextDeep = true; });
      await page.getByTestId('deep-dive-btn').click();
      await page.waitForFunction(previous => window.__deepStarts === previous + 1, count);
      await waitDepth(20);
    };
    await waitDepth(8);
    // Completion while hidden must retain the deeper score, PV and WDL.
    await startDeep();
    const searches = await goCount();
    await setHidden(page, true);
    await page.evaluate(() => window.__finishDeep());
    await page.waitForTimeout(120);
    await setHidden(page, false);
    await waitDepth(28);
    assert.equal(await goCount(), searches, 'Returning replaced the completed deep search');
    assert.match(await pv.getAttribute('aria-label'), /Red POV score -1\.2, depth 28, Red 10% · draw 20% · Black 70%/);
    assert.match(await page.getByTestId('deep-dive-btn').getAttribute('aria-label'), /^Deep search this position/);

    // A result completed in the foreground also survives a later tab switch.
    await startDeep();
    await page.evaluate(() => window.__finishDeep());
    await waitDepth(28);
    const completedSearches = await goCount();
    await setHidden(page, true);
    await setHidden(page, false);
    assert.equal(await goCount(), completedSearches);
    await waitDepth(28);
    await pv.screenshot({ path: `/tmp/xiangqi-deep-result-${browserType.name()}-${width}.png` });

    // Stopping an infinite search keeps its last completed iteration too.
    await page.getByTestId('deep-infinite-toggle').click();
    await startDeep();
    await page.getByTestId('deep-dive-btn').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="deep-dive-btn"]')?.textContent.includes('Stop'));
    const stoppedSearches = await goCount();
    await setHidden(page, true);
    await setHidden(page, false);
    assert.equal(await goCount(), stoppedSearches);
    await waitDepth(20);

    // Navigation invalidates the retained result; normal live analysis still resumes.
    await page.getByTestId('engine-pv-0-move-0').click();
    await waitDepth(8);
    assert.match(await page.locator('.hitbox[data-file="2"][data-rank="7"]').getAttribute('aria-label'), /black horse/);
    const ordinarySearches = await goCount();
    await setHidden(page, true);
    await setHidden(page, false);
    await page.waitForFunction(previous => window.__commands.filter(command => command.startsWith('go ')).length > previous, ordinarySearches);
    await waitDepth(8);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: completed/stopped deep results, background completion and navigation passed at ${width}px`);
  } catch (error) {
    await page.screenshot({ path: `/tmp/xiangqi-deep-result-failure-${browserType.name()}-${width}.png` });
    console.error(await page.locator('body').innerText());
    throw error;
  } finally { await page.close(); }
}
async function checkReal(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(base + '?moves=h2e2');
    await page.keyboard.press('e');
    const pv = page.getByTestId('engine-pv-line-0');
    await pv.waitFor({ timeout: 60000 });
    await page.getByTestId('deep-dive-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="deep-dive-btn"]')?.textContent.includes('Stop'));
    await setHidden(page, true);
    await page.waitForFunction(() => document.querySelector('[data-testid="deep-dive-btn"]')?.textContent.includes('Go Deep'), null, { timeout: 60000 });
    await page.waitForTimeout(150);
    const completed = await pv.getAttribute('aria-label');
    assert.match(completed, /depth [1-9][0-9]*,/);
    await setHidden(page, false);
    await page.waitForTimeout(2200);
    assert.equal(await pv.getAttribute('aria-label'), completed, 'Real deep result changed on return');
    await pv.screenshot({ path: `/tmp/xiangqi-deep-result-${browserType.name()}-real.png` });
    console.log(`${browserType.name()}: real Pikafish bounded search completed in background and retained its result`);
  } finally { await page.close(); }
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) await check(browser, width);
    if (process.env.XIANGQI_QA_REAL_DEEP === '1') await checkReal(browser);
  }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
