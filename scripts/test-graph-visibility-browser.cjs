const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function openGraph(page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Evaluation graph');
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 1100, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        // Count committed geometric point replacements, independently of the
        // source point/notation reuse regression. No production instrumentation.
        await page.addInitScript(() => {
          window.__geometry = null; window.__geometryReplaced = 0;
          window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
            supportsFiber: true, renderers: new Map(),
            inject(renderer) { this.renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {},
            onCommitFiberRoot(_id, root) {
              const stack = [root.current];
              while (stack.length) {
                const fiber = stack.pop();
                if (typeof fiber.type === 'function' && Array.isArray(fiber.memoizedProps?.history) && Object.hasOwn(fiber.memoizedProps, 'loadSweepToken')) {
                  for (let hook = fiber.memoizedState; hook; hook = hook.next) {
                    const value = Array.isArray(hook.memoizedState) ? hook.memoizedState[0] : null;
                    if (Array.isArray(value) && value[0]?.moveIndex === -1 && Object.hasOwn(value[0], 'x')) {
                      if (window.__geometry) window.__geometryReplaced += value.filter((point, index) => point !== window.__geometry[index]).length;
                      window.__geometry = value;
                    }
                  }
                }
                if (fiber.child) stack.push(fiber.child); if (fiber.sibling) stack.push(fiber.sibling);
              }
            },
          };
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            let position = '';
            window.__stream = score => emit('info depth 18 multipv 1 score cp ' + score + ' pv a0a1');
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('position ')) position = command;
              if (command.startsWith('go ')) window.__searchedPlies = position.includes(' moves ') ? position.split(' moves ')[1].trim().split(/ +/).length : 0;
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        await page.goto(base + '?moves=' + Array.from({ length: 1024 }, (_, i) => cycle[i % 4]).join('+'));
        await page.waitForFunction(() => window.__searchedPlies === 1024);
        if (width >= 900) {
          await page.waitForFunction(() => window.__geometry?.length === 1025);
          await page.getByTestId('left-panel-resize-handle').focus();
          await page.keyboard.press('Home');
        }
        if (width < 900) assert.equal(await page.locator('.graph-wrap').isVisible(), false);
        else await page.waitForFunction(() => document.querySelector('.panel.left')?.getBoundingClientRect().width === 0);
        await page.evaluate(() => { window.__geometryReplaced = 0; });
        for (const score of [100, 200, 300, 400]) {
          await page.evaluate(score => window.__stream(score), score);
          // Verify the live engine keeps updating a visible board reading even
          // when no graph is mounted. A missing graph cannot make this pass.
          await page.waitForFunction(({ score, mobile }) => Number(document.querySelector(mobile ? '.mobile-eval-chip' : '.eval-bar-readout')?.textContent) === score / 100, { score, mobile: width < 900 });
        }
        const work = await page.evaluate(() => window.__geometryReplaced);
        console.log(`${browserType.name()} ${width}px: four hidden live scores replaced ${work} geometric point objects`);
        if (process.env.XIANGQI_QA_MEASURE_ONLY) continue;
        assert.equal(work, 0, 'Hidden graph must not rebuild its plot');
        assert.equal(await page.locator('.graph-wrap').count(), 0, 'Hidden graph should release its DOM and observers');

        await openGraph(page);
        const navigator = page.getByRole('slider', { name: 'Evaluation graph move navigator' });
        await navigator.waitFor();
        await page.waitForFunction(() => window.__geometry?.length === 1025);
        assert.equal(await navigator.getAttribute('aria-valuenow'), '1024');
        assert.match(await navigator.getAttribute('aria-valuetext'), /\+4\.00/);
        // Prove the geometric instrumentation also observes real visible work.
        await page.evaluate(() => { window.__geometryReplaced = 0; window.__stream(500); });
        await page.waitForFunction(() => document.querySelector('[aria-label="Evaluation graph move navigator"]')?.getAttribute('aria-valuetext')?.includes('+5.00'));
        assert.ok(await page.evaluate(() => window.__geometryReplaced >= 1025));

        if (width < 900) {
          await page.getByTestId('mobile-analysis-tab-moves').click();
          assert.equal(await page.locator('.graph-wrap').count(), 0);
          await openGraph(page);
          await navigator.waitFor();
          await page.getByTestId('mobile-view-board').click();
          assert.equal(await page.locator('.graph-wrap').count(), 0);
          // Desktop visibility follows its panel width, independent of the
          // retained phone view; shrinking back restores the Board screen.
          await page.setViewportSize({ width: 1440, height: 900 });
          await navigator.waitFor();
          await page.setViewportSize({ width, height: 900 });
          await page.locator('.graph-wrap').waitFor({ state: 'detached' });
          await openGraph(page);
        } else {
          await page.getByTestId('left-panel-resize-handle').focus();
          await page.keyboard.press('Home');
          assert.equal(await page.locator('.graph-wrap').count(), 0);
          await openGraph(page);
        }
        await navigator.focus(); await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() => document.querySelector('[aria-label="Evaluation graph move navigator"]')?.getAttribute('aria-valuenow') === '1023');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-graph-visibility-${browserType.name()}-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: graph command opens the latest position; hide, reopen, resize and keyboard navigation pass`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
