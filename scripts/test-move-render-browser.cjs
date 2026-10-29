const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function noteIs(page, note) {
  await page.waitForFunction(note => document.querySelector('[data-testid="move-comment-input"]')?.value === note, note);
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const plies = 1024;
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
                if (['MoveChip', 'BreadcrumbChip'].includes(name)) {
                  const nodeId = fiber.memoizedProps.nodeId;
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
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ')) queueMicrotask(() => {
                if (window.__updateParent) emit('info depth 18 multipv 1 score cp 0 pv h9g7');
                emit('bestmove ' + (window.__updateParent ? 'h9g7' : '(none)'));
              });
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
        await page.goto(base + '?moves=' + Array.from({ length: plies }, (_, i) => cycle[i % 4]).join('+'));
        await page.getByTestId('start-engine-analysis').click();
        await page.locator('.xiangqi-board').waitFor();
        await page.keyboard.press('t');
        await page.waitForFunction(plies => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n' + plies, plies);
        assert.ok(await page.evaluate(() => window.__moveWork.some(item => item.name === 'MoveChip') && window.__moveWork.some(item => item.name === 'BreadcrumbChip')), 'Both render probes must observe the initial study');
        await page.evaluate(() => { document.activeElement?.blur(); window.__beforeMoveKeys = window.__mountedMoveKeys; window.__moveWork = []; });
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(plies => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n' + (plies - 1), plies);
        const work = await page.evaluate(() => window.__moveWork);
        const previouslyMounted = new Set(await page.evaluate(() => window.__beforeMoveKeys));
        assert.ok(work.some(item => item.name === 'MoveChip'), 'Navigation must redraw the active move');
        assert.ok(work.every(item => ['n1023', 'n1024'].includes(item.nodeId) || !previouslyMounted.has(item.name + ':' + item.nodeId)), `Unchanged entries rendered: ${JSON.stringify(work.slice(0, 12))}`);
        assert.ok(work.length <= 12, `A single navigation rendered ${work.length} entries`);
        await page.keyboard.press('t');
        assert.equal(await page.locator('.mtree-chip[tabindex="0"]').count(), 1);
        await page.locator('.mtree-chip[tabindex="0"]').focus();
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')), 'n1022');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-tree-active"]')?.dataset.nodeId === 'n1022');
        const crumbs = page.locator('.tree-breadcrumb-chip');
        await crumbs.last().focus(); await page.keyboard.press('Home');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-breadcrumb-index')), '0');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-breadcrumb-index')), '1022');
        assert.equal(await page.locator('.tree-breadcrumb-chip[tabindex="0"]').count(), 1);
        await page.screenshot({ path: `/tmp/xiangqi-move-render-${browserType.name()}-${width}.png` });
        console.log(`${browserType.name()} ${width}px: navigation in ${plies} plies rendered ${work.length} affected entries`);
        // Reuse node IDs with different moves: memoized labels must follow the loaded study.
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('h2e2 {[%eval -5.00] Cannon plan} (b2e2 {Other cannon}) h9g7 {[%eval 0.00]} *');
        await page.getByTestId('import-uci-line-btn').click(); await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await page.keyboard.press('t');
        const first = page.locator('.mtree-chip').filter({ hasText: 'h2e2' });
        const second = page.locator('.mtree-chip').filter({ hasText: 'h9g7' });
        await first.click(); await noteIs(page, 'Cannon plan');
        await command(page, 'Copy record');
        assert.equal(await page.evaluate(() => window.__copied), '1. C2=5');
        await second.click(); await command(page, 'Copy record');
        assert.equal(await page.evaluate(() => window.__copied), '1. C2=5 H8+7');
        await command(page, 'Write moves in Chinese');
        await command(page, 'Copy record');
        assert.equal(await page.evaluate(() => window.__copied), '1. 炮二平五 馬8進7');
        assert.ok((await crumbs.last().innerText()).includes('馬8進7'));
        await command(page, 'Write moves in WXF');
        await first.click();
        await page.getByTestId('move-comment-input').fill('Updated plan 新注');
        await page.getByTestId('move-comment-input').blur();
        await page.waitForFunction(() => [...document.querySelectorAll('.mtree-comment')].some(node => node.textContent === 'Updated plan 新注'));
        assert.match(await first.getAttribute('aria-label'), /Updated plan 新注/);
        assert.match(await second.getAttribute('class'), /quality-blunder/);
        await second.click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moves.length === 2);
        await page.evaluate(() => { window.__updateParent = true; });
        await first.click();
        await page.waitForFunction(() => [...document.querySelectorAll('.mtree-chip')].find(node => node.textContent.includes('h9g7'))?.classList.contains('quality-best'));
        await page.locator('.mtree-variation .mtree-chip').click(); await noteIs(page, 'Other cannon');
        await command(page, 'Copy record');
        assert.equal(await page.evaluate(() => window.__copied), '1. C8=5');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: keyboard focus, fresh imports, notation, current-line copying, note edits, parent-score quality and variations passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
