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
              // The saved Master setting uses depth 12; live analysis has a time budget.
              if (command === 'go depth 12 movetime 2500') window.__goCount++;
              // Return a legal move on stop, as a real UCI engine can do.
              if (command === 'stop') { window.__stopCount++; queueMicrotask(window.__finishMove); }
            } };
          };` }));
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([{
          id: 'paused-study', savedAt: 1, gameMode: 'PvAI-Black', label: 'Paused study',
          rootComment: 'Opening overview', moves: ['h2e2'],
          moveTree: [{ uci: 'h2e2', comment: 'Cannon plan' }, { uci: 'b2e2', comment: 'Other cannon' }],
        }])));
        await page.addInitScript(() => localStorage.setItem('xiangqi:preferences:v1', JSON.stringify({ aiStrength: 5 })));
        await page.goto(base);
        await page.locator('.xiangqi-board').waitFor();
        if (mobile) {
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-library').click();
        } else await page.getByRole('button', { name: 'Open game library', exact: true }).click();
        await page.getByTestId('load-saved-paused-study').click();
        await command(page, 'Find study notes');
        await page.locator('#study-notes-search').fill('Cannon plan');
        await page.locator('.study-note-result').waitFor();
        await command(page, 'Settings');
        const initialSearches = await page.evaluate(() => window.__goCount ?? 0);
        await page.locator('#settings-workspace-mode').selectOption('play');
        await page.getByRole('button', { name: 'Close settings', exact: true }).click();
        await page.waitForFunction(before => window.__goCount > before, initialSearches);
        await command(page, 'Find study notes');
        const note = page.locator('.study-note-result');
        assert.equal(await note.isDisabled(), true, 'Wait for the opponent or pause before visiting notes');
        const glyphs = page.getByTestId('imported-glyphs');
        await glyphs.locator(':scope > summary').click();
        const annotation = glyphs.locator('select[aria-label="Add study annotation"]');
        assert.equal(await annotation.isDisabled(), true);
        const mainLine = page.getByTestId('study-main-line');
        await mainLine.locator('summary').click();
        assert.equal(await page.getByTestId('pin-study-main-line').isDisabled(), true);
        const metadata = page.getByTestId('game-metadata');
        await metadata.locator('summary').click();
        const result = metadata.getByRole('combobox', { name: /Result at this position/ });
        assert.equal(await result.isDisabled(), true, 'An active opponent turn must lock result edits');
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
        assert.equal(await annotation.isEnabled(), true, 'Paused games must allow study annotations');
        assert.equal(await result.isEnabled(), true, 'Paused games must allow recorded results');
        assert.equal(await page.getByText('Pause play to edit study annotations.', { exact: true }).count(), 0);
        await annotation.selectOption('1');
        await glyphs.getByRole('button', { name: 'Apply symbol', exact: true }).click();
        await glyphs.getByRole('button', { name: 'Remove Good move ($1)', exact: true }).waitFor();
        await command(page, 'Set this as study main line');
        await page.waitForFunction(() => document.querySelector('[data-testid="study-main-line"] summary')?.textContent === 'Study main line set');
        await page.locator('#study-notes-search').fill('Other cannon');
        await note.click();
        const otherFen = await page.locator('.bottombar-fen').getAttribute('title');
        assert.notEqual(otherFen, fen);
        await page.getByTestId('open-study-main-line').click();
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        await command(page, 'Let PGN follow the selected line');
        assert.equal(await page.getByTestId('pin-study-main-line').isEnabled(), true);
        await page.getByTestId('pin-study-main-line').click();
        await page.locator('#study-notes-search').fill('Other cannon');
        await note.click();
        await command(page, 'Go to study main line');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), fen);
        await page.locator('#study-notes-search').fill('Cannon plan');
        await command(page, 'Save game');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === 2);
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.deepEqual(saved.moveTree[0].nags, [1]);
        assert.equal(saved.moveTree[0].uci, 'h2e2');
        assert.equal(saved.moveTree[1].uci, 'b2e2');
        assert.equal(saved.mainLinePinned, true);
        if (!await glyphs.evaluate(node => node.open)) await glyphs.locator(':scope > summary').click();
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.waitForFunction(size => parseFloat(getComputedStyle(document.querySelector('.study-note-result')).fontSize) === size * .8125, size);
          await note.evaluate(node => node.scrollIntoView({ block: 'center' }));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
          assert.equal(await note.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          await page.screenshot({ path: `/tmp/xiangqi-ai-pause-notes-${browserType.name()}-${width}-${size}.png` });
          for (const [panel, target, label] of [[mainLine, page.getByTestId('unpin-study-main-line'), 'main-line'], [glyphs, annotation, 'annotations'], [metadata, result, 'results']]) {
            if (panel === metadata && await metadata.getAttribute('open') === null) await metadata.locator('summary').click();
            await target.evaluate(node => node.scrollIntoView({ block: 'center' }));
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
            assert.equal(await target.evaluate(node => { const r = node.getBoundingClientRect(); return r.height >= 44 && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, `${label} controls must remain reachable`);
            assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
            await page.screenshot({ path: `/tmp/xiangqi-ai-pause-${label}-${browserType.name()}-${width}-${size}.png` });
          }
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
        await command(page, 'Find study notes');
        assert.equal(await annotation.isDisabled(), true, 'Resuming must lock annotations during the opponent turn');
        assert.equal(await result.isDisabled(), true, 'Resuming must lock recorded results during the opponent turn');
        assert.equal(await page.getByTestId('unpin-study-main-line').isDisabled(), true);
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Let PGN follow the selected line');
        assert.equal(await page.getByRole('option').filter({ hasText: 'Let PGN follow the selected line' }).getAttribute('aria-disabled'), 'true', 'Palette actions must refresh when play resumes');
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.__finishMove());
        await page.waitForFunction(fen => document.querySelector('.bottombar-fen')?.getAttribute('title') !== fen, fen);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: pause stops search, rejects late moves, enables notes/annotations/main-line controls, persists edits, resumes play and fits 100/200% text`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
