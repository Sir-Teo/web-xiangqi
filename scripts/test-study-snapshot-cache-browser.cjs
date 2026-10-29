const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
      localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'large', savedAt: 1, gameMode: 'PvP', label: 'Large saved study', result: 'ongoing',
        moves: Array.from({ length: 1024 }, (_, index) => cycle[index % cycle.length]) }]));
      const renderers = new Map();
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, renderers, inject(renderer) { renderers.set(1, renderer); return 1; }, onCommitFiberUnmount() {},
        onCommitFiberRoot(_id, root) {
          const stack = [root.current];
          while (stack.length) {
            const fiber = stack.pop(), name = fiber.elementType?.displayName || fiber.type?.displayName || fiber.type?.name;
            if (name === 'App') for (let hook = fiber.memoizedState; hook; hook = hook.next) {
              const value = hook.memoizedState?.[0];
              if (Array.isArray(value) && value[0]?.uci === 'a0a1' && !value[0]?.board) window.__storedTree = value;
            }
            if (name === 'MoveChip' && fiber.memoizedProps.nodeId === 'n1024') window.__scoreAtEnd = fiber.memoizedProps.record?.evalScore;
            if (fiber.child) stack.push(fiber.child); if (fiber.sibling) stack.push(fiber.sibling);
          }
        },
      };
    });
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = new Set(), emit = line => listeners.forEach(listener => listener(line));
        window.__complete = () => { emit('info depth 18 score cp 25 pv a0a1'); emit('bestmove a0a1'); };
        return { variant: 'single-simd', addMessageListener: fn => listeners.add(fn), removeMessageListener: fn => listeners.delete(fn), terminate() {},
          postMessage(command) {
            if (command === 'uci') queueMicrotask(() => emit('uciok'));
            if (command === 'isready') queueMicrotask(() => emit('readyok'));
            if (command.startsWith('go ')) window.__heldSearch = true;
            if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
          } };
      };` }));
    await page.goto(base);
    await page.getByTestId('left-panel-tab-library').click();
    await page.getByTestId('load-saved-large').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="study-save-status"]')?.textContent.includes('Saved study') && window.__storedTree?.length === 1);
    await page.getByTestId('start-engine-analysis').click();
    await page.waitForFunction(() => window.__heldSearch);
    await page.evaluate(() => { window.__beforeTree = window.__storedTree; window.__beforeBytes = JSON.stringify(window.__beforeTree); window.__complete(); });
    await page.waitForFunction(() => window.__scoreAtEnd === 25);
    assert.equal(await page.evaluate(() => window.__storedTree === window.__beforeTree), true, 'Automatic evaluation rebuilt the stored tree');
    assert.match(await page.getByTestId('study-save-status').innerText(), /Saved study/);
    await page.getByTestId('move-comment-input').fill('Preserve this new annotation 新注');
    await page.getByTestId('move-comment-input').blur();
    await page.waitForFunction(() => window.__storedTree !== window.__beforeTree);
    assert.match(await page.getByTestId('study-save-status').innerText(), /Modified study/);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__beforeTree) === window.__beforeBytes), true, 'A later edit mutated the old snapshot');
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    const saved = await page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1'));
      let cursor = snapshot.game.moveTree[0]; while (cursor.children?.length) cursor = cursor.children[0];
      return { plies: snapshot.game.moves.length, finalEval: snapshot.game.finalEval, comment: cursor.comment };
    });
    assert.deepEqual(saved, { plies: 1024, finalEval: 25, comment: 'Preserve this new annotation 新注' });
    assert.deepEqual(errors, []); await page.close();
    console.log(`${browserType.name()}: automatic scores reuse the stored tree and preserve Saved status; real notes invalidate it, leave old snapshots intact and survive an immediate close-time flush`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
