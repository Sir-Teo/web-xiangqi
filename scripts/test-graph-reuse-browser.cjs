const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
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
      try {
        await page.addInitScript(() => {
          window.__graphPoints = null; window.__graphReplaced = 0;
          window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
            supportsFiber: true, renderers: new Map(),
            inject(renderer) { this.renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {},
            onCommitFiberRoot(_id, root) {
              const stack = [root.current];
              while (stack.length) {
                const fiber = stack.pop();
                if (typeof fiber.type === 'function' && Array.isArray(fiber.memoizedProps?.history) && Object.hasOwn(fiber.memoizedProps, 'loadSweepToken')) {
                  let points;
                  for (let hook = fiber.memoizedState; hook; hook = hook.next) {
                    const value = Array.isArray(hook.memoizedState) ? hook.memoizedState[0] : null;
                    if (Array.isArray(value) && value[0]?.moveIndex === -1 && Object.hasOwn(value[0], 'notation') && !Object.hasOwn(value[0], 'x')) points = value;
                  }
                  if (points) {
                    if (window.__graphPoints) window.__graphReplaced += points.filter((point, index) => point !== window.__graphPoints[index]).length;
                    window.__graphPoints = points;
                    window.__graphIndex = fiber.memoizedProps.currentMoveIndex;
                    window.__graphSearching = fiber.memoizedProps.isSearching;
                  }
                }
                if (fiber.child) stack.push(fiber.child); if (fiber.sibling) stack.push(fiber.sibling);
              }
            },
          };
        });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            let position = '';
            window.__stream = score => {
              const plies = position.includes(' moves ') ? position.split(' moves ')[1].trim().split(/ +/).length : 0;
              emit('info depth 18 multipv 1 score cp ' + score + ' pv ' + ['a0a1', 'a9a8', 'a1a0', 'a8a9'][plies % 4]);
            };
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('position ')) position = command;
              if (command.startsWith('go ')) {
                window.__searchStarted = true;
                window.__searchedPlies = position.includes(' moves ') ? position.split(' moves ')[1].trim().split(/ +/).length : 0;
              }
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        await page.goto(base + '?moves=' + Array.from({ length: 1024 }, (_, i) => cycle[i % 4]).join('+'));
        if (width < 900) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-graph').click();
        }
        await page.waitForFunction(() => window.__graphPoints?.length === 1025 && window.__searchStarted);
        const navigator = page.getByRole('slider', { name: 'Evaluation graph move navigator' });
        await navigator.focus();
        await page.evaluate(() => { window.__graphReplaced = 0; });
        for (let step = 1; step <= 10; step++) {
          await page.keyboard.press('ArrowLeft');
          await page.waitForFunction(index => window.__graphIndex === index, 1023 - step);
        }
        const navigation = await page.evaluate(() => window.__graphReplaced);
        console.log(`${browserType.name()} ${width}px: ten navigation steps replaced ${navigation} historical graph point objects`);
        if (!process.env.XIANGQI_QA_MEASURE_ONLY) assert.ok(navigation <= 20, 'Navigation must not reformat every historical graph point');
        await page.waitForFunction(() => window.__graphSearching && window.__searchedPlies === 1014);
        await page.evaluate(() => { window.__graphReplaced = 0; });
        for (const score of [25, 50, 75, 100]) {
          await page.evaluate(score => window.__stream(score), score);
          await page.waitForFunction(score => window.__graphPoints[window.__graphIndex + 1]?.eval === score, score, { timeout: 5000 }).catch(async error => {
            console.log(await page.evaluate(() => ({ index: window.__graphIndex, plies: window.__searchedPlies, searching: window.__graphSearching, point: window.__graphPoints[window.__graphIndex + 1], legend: document.querySelector('.graph-legend')?.textContent })));
            throw error;
          });
        }
        const streaming = await page.evaluate(() => window.__graphReplaced);
        console.log(`${browserType.name()} ${width}px: four live scores replaced ${streaming} historical graph point objects`);
        if (!process.env.XIANGQI_QA_MEASURE_ONLY) assert.ok(streaming <= 4, 'Live scores must only replace their projected point');
        assert.match(await navigator.getAttribute('aria-valuetext'), /\+1\.00/);
        await command(page, 'Write moves in Chinese (中文)');
        await page.waitForFunction(() => /[\u3400-\u9fff]/.test(window.__graphPoints[1].notation));
        assert.match(await navigator.getAttribute('aria-valuetext'), /[\u3400-\u9fff]/);
        await command(page, 'Write moves in WXF letters');
        await page.waitForFunction(() => window.__graphPoints[1].notation === 'R9+1');
        assert.match(await navigator.getAttribute('aria-valuetext'), /R1\+1/);
        await navigator.focus();
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() => window.__graphIndex === 1012);
        assert.equal(await page.evaluate(() => window.__graphPoints[1014].eval), null, 'A projected live score must not mutate the historical point');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-graph-reuse-${browserType.name()}-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: notation changes update labels and live projection leaves unscored history unchanged`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
