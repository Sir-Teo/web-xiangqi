const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        // React 18's DevTools commit hook records actual Board work (flag 1),
        // including memo bailouts. No application instrumentation or timing
        // threshold: this checks work counts in development and production.
        await page.addInitScript(() => {
          window.__boardWork = [];
          const renderers = new Map();
          window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
            supportsFiber: true, renderers,
            inject(renderer) { renderers.set(1, renderer); return 1; },
            onCommitFiberUnmount() {},
            onCommitFiberRoot(_id, root) {
              const stack = [root.current];
              while (stack.length) {
                const fiber = stack.pop();
                if ((fiber.elementType?.displayName || fiber.type?.displayName || fiber.type?.name) === 'Board') {
                  window.__boardWork.push({ rendered: Boolean(fiber.flags & 1), changed: Object.keys(fiber.memoizedProps).filter(key => fiber.memoizedProps[key] !== fiber.alternate?.memoizedProps?.[key]) });
                }
                if (fiber.child) stack.push(fiber.child);
                if (fiber.sibling) stack.push(fiber.sibling);
              }
            },
          };
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            window.__pulse = (n, move = 'h2e2') => emit('info depth 12 multipv 1 score cp ' + (n * 100) + ' nodes ' + (n * 1000) + ' nps 1000 pv ' + move);
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ')) window.__pulse(1);
              if (command === 'stop') queueMicrotask(() => emit('bestmove h2e2'));
            } };
          };` }));
        const command = async label => {
          await page.keyboard.press('ControlOrMeta+k');
          await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
          await page.keyboard.press('Enter');
        };
        await page.goto(base);
        await page.waitForFunction(() => typeof window.__pulse === 'function');
        // A user marker must survive hiding, analysis updates, and showing.
        const square = page.locator('.xiangqi-board .hitbox[data-file="0"][data-rank="4"]');
        await square.focus(); await page.keyboard.press('Shift+Enter');
        assert.match(await square.getAttribute('aria-label'), /highlighted/);
        await command('Hide arrows and markers');
        await page.keyboard.press('e');
        await page.waitForFunction(() => document.querySelector('[data-testid="engine-pv-score-0"] strong')?.textContent === '+1.0');
        assert.ok(await page.evaluate(() => window.__boardWork.some(item => item.rendered)), 'The render probe did not observe the Board');
        await page.getByTestId('engine-pv-score-0').waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => { window.__boardWork = []; });
        for (let n = 2; n <= 11; n++) {
          await page.evaluate(n => window.__pulse(n), n);
          await page.waitForFunction(n => document.querySelector('[data-testid="engine-pv-score-0"] strong')?.textContent === '+' + n + '.0', n);
        }
        const work = await page.evaluate(() => window.__boardWork);
        assert.ok(work.length >= 10, 'The test did not observe all ten visible engine updates');
        const renders = work.filter(item => item.rendered);
        console.log(`${browserType.name()} ${width}px: ten visible engine updates, ${renders.length} unchanged-board renders; changed props ${JSON.stringify([...new Set(renders.flatMap(item => item.changed))])}`);
        assert.equal(renders.length, 0, 'An unchanged board rendered while arrows and markers were hidden');
        assert.equal(await page.locator('.board-arrow-group').count(), 0);
        await command('Show arrows and markers');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        assert.match(await square.getAttribute('aria-label'), /highlighted/);
        await page.waitForFunction(() => document.querySelectorAll('.board-arrow-group').length > 0);
        await page.keyboard.press('e');
        const previousArrow = await page.locator('.board-arrow-engine').first().innerHTML();
        await page.getByTestId('engine-pv-score-0').waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => { window.__boardWork = []; });
        for (let n = 12; n <= 21; n++) {
          await page.evaluate(n => window.__pulse(n), n);
          await page.waitForFunction(n => document.querySelector('[data-testid="engine-pv-score-0"] strong')?.textContent === '+' + n + '.0', n);
        }
        const visibleWork = await page.evaluate(() => window.__boardWork);
        assert.ok(visibleWork.length >= 10);
        const visibleRenders = visibleWork.filter(item => item.rendered);
        console.log(`${browserType.name()} ${width}px: arrows visible, ten score updates, ${visibleRenders.length} unchanged-board renders; changed props ${JSON.stringify([...new Set(visibleRenders.flatMap(item => item.changed))])}`);
        assert.equal(visibleRenders.length, 0, 'Unchanged visible arrows caused a board render');
        assert.equal(await page.locator('.board-arrow-engine').first().innerHTML(), previousArrow);
        await page.evaluate(() => window.__pulse(22, 'b2e2'));
        await page.waitForFunction(previous => document.querySelector('.board-arrow-engine')?.innerHTML !== previous, previousArrow);
        assert.ok(await page.evaluate(() => window.__boardWork.some(item => item.rendered)), 'A changed recommendation must redraw the arrow');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        assert.equal(await page.locator('.xiangqi-board .piece').count(), 32);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
