const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, text) {
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await search.fill(text); await page.keyboard.press('Enter'); await search.waitFor({ state: 'hidden' });
}
async function editorFocused(page) {
  await page.waitForFunction(() => {
    const input = document.getElementById('move-comment-input');
    if (!input || input !== document.activeElement) return false;
    const box = input.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input;
  }, undefined, { timeout: 5000 }).catch(async error => {
    console.error('Note editor focus:', await page.evaluate(() => {
      const input = document.getElementById('move-comment-input');
      const box = input?.getBoundingClientRect();
      const hit = box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { activeId: document.activeElement?.id, activeText: document.activeElement?.textContent?.slice(0, 100),
        box: box?.toJSON(), hit: hit?.outerHTML.slice(0, 250), stops: window.__stopCount };
    }));
    await page.screenshot({ path: `/tmp/xiangqi-write-note-focus-${browserType.name()}-${page.viewportSize().width}.png` });
    throw error;
  });
}
async function installEngine(page) {
  await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.Pikafish = function() {};
    window.Pikafish.createWorkerEngine = async () => {
      const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
      window.__goCount = 0; window.__stopCount = 0;
      window.__finishMove = () => emit('bestmove h9g7');
      return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
        if (command === 'uci') queueMicrotask(() => emit('uciok'));
        if (command === 'isready') queueMicrotask(() => emit('readyok'));
        if (command.startsWith('go ')) window.__goCount++;
        if (command === 'stop') { window.__stopCount++; queueMicrotask(window.__finishMove); }
      } };
    };` }));
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [390, 640], [320, 480], [844, 390]]) {
      const mobile = width < 900;
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await installEngine(page);
        await page.addInitScript(() => {
          localStorage.setItem('xiangqi:preferences:v1', JSON.stringify({ aiStrength: 5 }));
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'write-note', savedAt: 1,
            gameMode: 'PvAI-Black', moves: ['h2e2'], rootComment: 'Opening overview',
            moveTree: [{ uci: 'h2e2', comment: 'Original plan' }, { uci: 'b2e2', comment: 'Other cannon' }] }]));
        });
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Library'); await page.getByTestId('load-saved-write-note').click();
        await command(page, 'Settings');
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.waitForFunction(() => window.__goCount > 0);
        await command(page, 'Move tree');
        const input = page.getByTestId('move-comment-input');
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        const initialStops = await page.evaluate(() => window.__stopCount);
        await input.fill('Manual note while the opponent was thinking');
        await page.waitForFunction(before => window.__stopCount > before, initialStops, { timeout: 2000 });
        await editorFocused(page);
        await page.evaluate(() => window.__finishMove());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'Writing must keep the note on its original position despite a late AI answer');
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0]?.moveTree[0].comment === 'Manual note while the opponent was thinking');
        const searches = await page.evaluate(() => window.__goCount);
        if (mobile) await page.getByTestId('mobile-view-board').click();
        await page.getByRole('button', { name: mobile ? 'Resume AI' : 'Resume AI game', exact: true }).click();
        await page.waitForFunction(before => window.__goCount > before, searches);
        const entryStops = await page.evaluate(() => window.__stopCount);
        if (mobile) {
          const menuButton = page.getByTestId('mobile-more-actions-btn');
          await menuButton.click();
          const action = page.getByRole('menuitem', { name: 'Write note', exact: true });
          assert.match(await action.getAttribute('title'), /Pause/i);
          for (const font of [16, 32]) {
            await page.evaluate(font => document.documentElement.style.fontSize = font + 'px', font);
            await action.scrollIntoViewIfNeeded();
            const fit = await action.evaluate(node => {
              const box = node.getBoundingClientRect();
              return { height: box.height, width: box.width, x: box.x, right: box.right,
                scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
                reachable: node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
            });
            assert.ok(fit.height >= 43.99 && fit.x >= 0 && fit.right <= width + 1
              && fit.scrollWidth <= fit.clientWidth + 1 && fit.reachable,
            `Write note must fit and stay reachable (${width}px, ${font}px text): ${JSON.stringify(fit)}`);
            const menu = page.getByRole('menu', { name: 'More board actions', exact: true });
            const headerTop = await page.locator('.mobile-board-header').evaluate(node => node.getBoundingClientRect().top);
            assert.ok(headerTop >= -1, 'Opening enlarged board actions must keep the board header visible');
            if (font === 32) assert.equal(await menu.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
            for (const item of await menu.getByRole('menuitem').all()) {
              await item.scrollIntoViewIfNeeded();
              const reachable = await item.evaluate(node => {
                const box = node.getBoundingClientRect();
                const label = node.querySelector('span');
                return box.height >= 43.99 && box.top >= 0 && box.bottom <= innerHeight + 1
                  && node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
                  && (!label || label.scrollWidth <= label.clientWidth + 1);
              });
              assert.equal(reachable, true, `Board action is clipped or unreachable (${width}px, ${font}px text): ${await item.textContent()}`);
            }
            assert.ok(Math.abs(await page.locator('.mobile-board-header').evaluate(node => node.getBoundingClientRect().top) - headerTop) < 1,
              'Scrolling board actions must keep the board header in place');
          }
          await action.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/xiangqi-write-note-menu-${browserType.name()}-${width}.png` });
          await action.focus(); await page.keyboard.press('Enter');
          await editorFocused(page);
          assert.equal(await page.getByRole('menu', { name: 'More board actions' }).count(), 0);
          assert.equal(await page.getByTestId('mobile-analysis-tab-moves').getAttribute('aria-selected'), 'true');
        } else {
          await command(page, 'Write a note'); await editorFocused(page);
        }
        await page.waitForFunction(before => window.__stopCount > before, entryStops, { timeout: 2000 });
        await page.evaluate(() => window.__finishMove());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'The explicit note action must pause before opening the editor');
        assert.equal(await input.inputValue(), 'Manual note while the opponent was thinking');
        await input.fill('A complete annotation on the selected cannon move');
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0]?.moveTree[0].comment === 'A complete annotation on the selected cannon move');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')));
        assert.equal(saved.length, 1); assert.deepEqual(saved[0].moves, ['h2e2']);
        assert.equal(saved[0].rootComment, 'Opening overview');
        assert.equal(saved[0].moveTree[1].comment, 'Other cannon');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: writing and explicit note entry pause AI, reject late moves, focus the editor, preserve both branches, and fit 100/200% text`);
      } finally { await page.close(); }

      const root = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, reducedMotion: 'reduce' });
      try {
        const engineRequests = []; root.on('request', request => { if (request.url().endsWith('/pikafish.js')) engineRequests.push(request.url()); });
        await root.goto(base); await root.locator('.xiangqi-board').waitFor();
        if (mobile) {
          await root.getByTestId('mobile-more-actions-btn').click();
          await root.getByRole('menuitem', { name: 'Write note', exact: true }).click();
        } else {
          const handle = root.getByRole('separator', { name: /Resize right analysis panel/ });
          await handle.focus(); await handle.press('Home');
          await command(root, 'Write a note');
        }
        await editorFocused(root);
        const input = root.getByRole('textbox', { name: 'Note on starting position', exact: true });
        await input.fill('Starting-position plan'); await root.keyboard.press('ControlOrMeta+s');
        await root.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]')[0]?.rootComment === 'Starting-position plan');
        assert.equal(engineRequests.length, 0, 'Writing a starting-position note must not download the analysis engine');
        console.log(`${browserType.name()} ${width}px: starting-position note entry and save work without starting the engine`);
      } finally { await root.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
