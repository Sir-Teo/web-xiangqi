const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          window.__moveWork = [];
          window.__mountedMoveKeys = [];
          const renderers = new Map();
          const previousFibers = new Map();
          window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
            supportsFiber: true, renderers,
            inject(renderer) { renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {},
            onCommitFiberRoot(_id, root) {
              const mounted = [];
              const stack = [root.current];
              while (stack.length) {
                const fiber = stack.pop();
                const name = fiber.elementType?.displayName || fiber.type?.displayName || fiber.type?.name;
                if (name === 'MoveListTree') for (let hook = fiber.memoizedState; hook; hook = hook.next) {
                  const value = hook.memoizedState?.[0];
                  if (Array.isArray(value) && value[0]?.key?.startsWith('row-')) window.__rowModel = value;
                  if (value?.rowByNode instanceof Map && Array.isArray(value.ids)) window.__navigationModel = value;
                }
                if (['MoveChip', 'BreadcrumbChip'].includes(name)) {
                  const nodeId = fiber.memoizedProps.nodeId;
                  if (name === 'MoveChip' && nodeId === 'n1024') window.__observedScore = fiber.memoizedProps.record?.evalScore;
                  const key = name + ':' + nodeId;
                  mounted.push(key);
                  // A bailed-out parent can reuse its child fiber, including old flags.
                  if (previousFibers.get(key) !== fiber && (fiber.flags & 1)) window.__moveWork.push({ name, nodeId });
                  previousFibers.set(key, fiber);
                }
                if (fiber.child) stack.push(fiber.child); if (fiber.sibling) stack.push(fiber.sibling);
              }
              window.__mountedMoveKeys = mounted;
            },
          };
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
        });
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            let first = true, lastScore = 0; const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            window.__streamScore = score => emit('info depth 18 multipv 1 score cp ' + score + ' pv a0a1');
            window.__completeScore = score => { lastScore = score; window.__streamScore(score); emit('bestmove a0a1'); };
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ')) queueMicrotask(() => {
                if (first) { first = false; window.__searchHeld = true; }
                else window.__completeScore(lastScore);
              });
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        await page.goto(base + '?moves=' + Array.from({ length: 1024 }, (_, i) => cycle[i % 4]).join('+'));
        await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => window.__searchHeld);
        await page.keyboard.press('t');
        await page.getByTestId('move-tree-active').waitFor();
        const labels = await page.locator('.tree-breadcrumb-chip').allTextContents();
        const score = 25;
        await page.evaluate(score => { window.__beforeMoveKeys = window.__mountedMoveKeys; window.__beforeRowModel = window.__rowModel; window.__beforeNavigationModel = window.__navigationModel; window.__moveWork = []; window.__completeScore(score); }, score);
        await page.waitForFunction(score => window.__observedScore === score, score);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => window.__beforeRowModel?.length), 512, 'The model probe must observe all move rows');
        assert.equal(await page.evaluate(() => window.__rowModel === window.__beforeRowModel && window.__navigationModel === window.__beforeNavigationModel), true, 'A score update rebuilt the structural row/navigation model');
        const work = await page.evaluate(() => window.__moveWork);
        const previouslyMounted = new Set(await page.evaluate(() => window.__beforeMoveKeys));
        console.log(`${browserType.name()} ${width}px: completed score ${score} rendered ${work.length} move/breadcrumb entries`);
        if (!process.env.XIANGQI_QA_MEASURE_ONLY) {
          assert.ok(work.some(item => item.name === 'MoveChip' && item.nodeId === 'n1024'));
          assert.ok(work.every(item => item.nodeId === 'n1024' || !previouslyMounted.has(item.name + ':' + item.nodeId)), `Unchanged entries rendered: ${JSON.stringify(work.slice(0, 8))}`);
          assert.ok(work.length <= 12, `A completed score rendered ${work.length} entries`);
        }
        assert.deepEqual(await page.locator('.tree-breadcrumb-chip').allTextContents(), labels);
        await page.evaluate(() => { window.__beforeMoveKeys = window.__mountedMoveKeys; window.__moveWork = []; });
        await page.getByTestId('move-comment-input').fill('Score checked');
        await page.getByTestId('move-comment-input').blur();
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.getAttribute('aria-label').includes('Score checked'));
        if (!process.env.XIANGQI_QA_MEASURE_ONLY) {
          const noteWork = await page.evaluate(() => window.__moveWork);
          const beforeNote = new Set(await page.evaluate(() => window.__beforeMoveKeys));
          assert.ok(noteWork.length > 0 && noteWork.length <= 12 && noteWork.every(item => item.nodeId === 'n1024' || !beforeNote.has(item.name + ':' + item.nodeId)), 'A note edit redrew unrelated move entries');
        }
        assert.equal(await page.evaluate(() => window.__rowModel === window.__beforeRowModel && window.__navigationModel === window.__beforeNavigationModel), true, 'A note edit rebuilt the structural row/navigation model');
        // Delegated navigation must use the latest tree, including after a
        // score update, and accept clicks on the notation span inside a chip.
        await page.locator('.mtree-chip[data-node-id="n1023"] .move-uci').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n1023');
        await page.locator('.tree-breadcrumb-chip[data-breadcrumb-index="1022"] .tree-breadcrumb-sep').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n1022');
        await page.locator('.tree-breadcrumb-chip').last().focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.getAttribute('aria-label') === 'Note on starting position');
        assert.equal(await page.locator('.tree-breadcrumb-chip').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
