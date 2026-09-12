const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function savedAtPly(page, ply) {
  await page.waitForFunction(ply => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moves.length === ply, ply);
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          // Observe committed React 18 memo values, in development or production.
          // This measures retained tree allocations, not browser elapsed time.
          window.__snapshot = null; window.__lastTree = undefined; window.__treeChanges = 0;
          window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
            supportsFiber: true, renderers: new Map(),
            inject(renderer) { this.renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {},
            onCommitFiberRoot(_id, root) {
              const pending = [root.current];
              while (pending.length) {
                const fiber = pending.pop();
                // Only function components hold a hook list.
                if (typeof fiber.type === 'function') for (let hook = fiber.memoizedState; hook; hook = hook.next) {
                  const value = Array.isArray(hook.memoizedState) ? hook.memoizedState[0] : null;
                  if (value && value.gameMode && Array.isArray(value.moves) && Object.hasOwn(value, 'moveTree') && Object.hasOwn(value, 'review') && Object.hasOwn(value, 'rootComment')) {
                    window.__snapshot = value;
                    if (value.moveTree !== window.__lastTree) window.__treeChanges++;
                    window.__lastTree = value.moveTree;
                  }
                }
                if (fiber.child) pending.push(fiber.child); if (fiber.sibling) pending.push(fiber.sibling);
              }
            },
          };
          if (!sessionStorage.getItem('snapshot-fixture-seeded')) {
            const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
            const moves = Array.from({ length: 1024 }, (_, i) => cycle[i % 4]);
            let tree;
            for (let i = moves.length - 1; i >= 0; i--) tree = [{ uci: moves[i], ...(i === 0 ? { comment: 'Original opening note' } : {}), ...(tree ? { children: tree } : {}) }];
            localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'snapshot-study', savedAt: 1, gameMode: 'PvP', moves, moveTree: tree }]));
            sessionStorage.setItem('snapshot-fixture-seeded', '1');
          }
        });
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
        await page.goto(base); await command(page, 'Library');
        await page.getByTestId('load-saved-snapshot-study').click();
        await page.waitForFunction(() => window.__snapshot?.moves.length === 1024 && window.__snapshot.moveTree?.length);
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.evaluate(() => { window.__treeChanges = 0; });
        for (let i = 1; i <= 10; i++) {
          await page.locator('button[aria-label="Go to previous move"]:visible').first().click();
          await page.waitForFunction(ply => window.__snapshot?.moves.length === ply, 1024 - i);
        }
        const navigationChanges = await page.evaluate(() => window.__treeChanges);
        assert.equal(navigationChanges, 0, 'cursor navigation must reuse the unchanged serialized study');
        await page.keyboard.press('t');
        const editor = page.getByTestId('game-metadata');
        await editor.locator('summary').click();
        await page.evaluate(() => { window.__treeChanges = 0; });
        await editor.getByLabel('Event', { exact: true }).pressSequentially('Autumn Cup');
        await page.waitForFunction(() => window.__snapshot?.metadata?.event === 'Autumn Cup');
        const metadataChanges = await page.evaluate(() => window.__treeChanges);
        assert.equal(metadataChanges, 0, 'typing game details must not rebuild the move tree');
        await page.getByTestId('move-comment-input').fill('Updated continuation 新注');
        await page.getByTestId('move-comment-input').blur();
        await page.waitForFunction(() => window.__treeChanges > 0);
        await savedAtPly(page, 1014);
        await page.waitForFunction(() => localStorage.getItem('xiangqi:auto-saved-game:v1')?.includes('Updated continuation 新注'));
        const game = JSON.parse(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1'))).game;
        let siblings = game.moveTree; let count = 0; let note;
        while (siblings?.length) { count++; if (count === 1014) note = siblings[0].comment; siblings = siblings[0].children; }
        assert.equal(count, 1024); assert.equal(note, 'Updated continuation 新注');
        assert.equal(game.moveTree[0].comment, 'Original opening note');
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.keyboard.press('t');
        await page.waitForFunction(() => document.querySelector('[data-testid="move-comment-input"]')?.value === 'Updated continuation 新注');
        await editor.locator('summary').click();
        assert.equal(await editor.getByLabel('Event', { exact: true }).inputValue(), 'Autumn Cup');
        // An ordinary unannotated line only needs a tree while saved before its end.
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
        await page.getByTestId('uci-line-input').fill('h2e2 h9g7');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await savedAtPly(page, 2);
        assert.ok(!await page.evaluate(() => window.__snapshot.moveTree));
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.locator('button[aria-label="Go to previous move"]:visible').first().click();
        await savedAtPly(page, 1);
        assert.equal(await page.evaluate(() => window.__snapshot.moveTree[0].children[0].uci), 'h9g7');
        await page.locator('button[aria-label="Go to next move"]:visible').first().click();
        await savedAtPly(page, 2);
        assert.ok(!await page.evaluate(() => window.__snapshot.moveTree));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: ${JSON.stringify({ navigationChanges, metadataChanges })}; fresh annotations, cursor recovery and compact full-line storage passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
