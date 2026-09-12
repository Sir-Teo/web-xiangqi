const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const command = async (page, label) => {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
};
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const mobile = width < 900;
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: mobile, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            window.__goCount = 0; window.__stopCount = 0;
            window.__finishMove = () => emit('bestmove h9g7');
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              // Default Master uses depth 12; live analysis has a time budget.
              if (command === 'go depth 12') window.__goCount++;
              // Return a legal move on stop, as a real UCI engine can do.
              if (command === 'stop') { window.__stopCount++; queueMicrotask(window.__finishMove); }
            } };
          };` }));
        await page.goto(base + '?moves=h2e2&mode=PvAI-Black');
        await page.locator('.xiangqi-board').waitFor();
        await command(page, 'Go to start');
        await command(page, 'Write a note on this move');
        await page.getByTestId('move-comment-input').fill('Opening overview');
        await page.getByTestId('move-comment-input').blur();
        await command(page, 'Go to latest move');
        await command(page, 'Write a note on this move');
        await page.getByTestId('move-comment-input').fill('Cannon plan');
        await page.getByTestId('move-comment-input').blur();
        await command(page, 'Find study notes');
        await page.locator('#study-notes-search').fill('Cannon plan');
        await page.locator('.study-note-result').waitFor();
        await command(page, 'Settings');
        const initialSearches = await page.evaluate(() => window.__goCount);
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.waitForFunction(before => window.__goCount > before, initialSearches);
        await command(page, 'Find study notes');
        const note = page.locator('.study-note-result');
        assert.equal(await note.isDisabled(), true, 'Wait for the opponent or pause before visiting notes');
        const fen = await page.locator('.bottombar-fen').getAttribute('title');
        if (mobile) await page.getByTestId('mobile-view-board').click();
        const stops = await page.evaluate(() => window.__stopCount);
        await page.getByRole('button', { name: mobile ? 'Pause AI' : 'Pause AI game', exact: true }).click();
        // Flush the held search even if the application failed to send stop.
        await page.evaluate(() => window.__finishMove());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'A late AI move must not change a paused board');
        assert.equal(await page.evaluate(() => window.__stopCount > 0), true);
        assert.ok(await page.evaluate(() => window.__stopCount) > stops, 'Pause must stop active computation');
        await command(page, 'Find study notes');
        assert.equal(await note.isEnabled(), true, 'Pausing must enable the promised note navigation');
        assert.equal(await page.getByText('Pause play to visit a note.', { exact: true }).count(), 0);
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.waitForFunction(size => parseFloat(getComputedStyle(document.querySelector('.study-note-result')).fontSize) === size * .8125, size);
          await note.evaluate(node => node.scrollIntoView({ block: 'center' }));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
          assert.equal(await note.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          await page.screenshot({ path: `/tmp/xiangqi-ai-pause-notes-${browserType.name()}-${width}-${size}.png` });
        }
        await page.locator('#study-notes-search').fill('Opening overview');
        await note.focus(); await page.keyboard.press('Enter');
        assert.notEqual(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'The note must navigate to the earlier position');
        await page.locator('#study-notes-search').fill('Cannon plan');
        await note.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen, 'The note must return to the AI position while paused');
        assert.equal(await note.getAttribute('aria-current'), 'location');
        await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
        if (mobile) await page.getByTestId('mobile-view-board').click();
        const searches = await page.evaluate(() => window.__goCount);
        await page.getByRole('button', { name: mobile ? 'Resume AI' : 'Resume AI game', exact: true }).click();
        await page.waitForFunction(before => window.__goCount > before, searches);
        await page.evaluate(() => window.__finishMove());
        await page.waitForFunction(fen => document.querySelector('.bottombar-fen')?.getAttribute('title') !== fen, fen);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: pause stops search, rejects late moves, enables notes, resumes play and fits 100/200% text`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
