const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
const setup = async page => {
  await page.addInitScript(() => {
    localStorage.setItem('xiangqi:library:v1', JSON.stringify([{ id: 'repertoire', savedAt: 1, gameMode: 'PvP', label: 'Cannon repertoire 炮', rootComment: 'Opening plan <b>literal text</b>', moves: ['h2e2'],
      moveTree: [
        { uci: 'h2e2', comment: 'Keep this note ' + '準備'.repeat(100), children: [{ uci: 'h9g7', comment: 'Right horse reply', children: [{ uci: 'h0g2', comment: 'Develop the right horse' }] }, { uci: 'b9c7', comment: 'Left horse reply', children: [{ uci: 'b0c2', comment: 'Develop the left horse' }] }] },
        { uci: 'b2e2', comment: 'Other cannon', children: [{ uci: 'h9g7', comment: 'Other line reply' }] },
      ],
    }, { id: 'black-root', savedAt: 2, gameMode: 'PvP', label: 'Black to move', moves: ['h9g7'],
      startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1' },
    { id: 'invalid', savedAt: 3, gameMode: 'PvP', label: 'Invalid move fixture', moves: ['h0h2'] }]));
  });
  await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.Pikafish = function() {};
    window.Pikafish.createWorkerEngine = async () => {
      const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
      window.__releaseAiMove = () => emit('bestmove h9g7'); window.__goCount = 0;
      return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
        if (command === 'uci') queueMicrotask(() => emit('uciok'));
        if (command === 'isready') queueMicrotask(() => emit('readyok'));
        if (command.startsWith('go ')) { window.__goCount++; if (!window.__holdAiMove) queueMicrotask(() => emit('bestmove (none)')); }
        if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
      } };
    };` }));
};
const openLibrary = async (page, width) => {
  if (width < 900) {
    await page.getByTestId('mobile-view-analysis').click();
    await page.getByTestId('mobile-analysis-tab-library').click();
  } else await page.getByRole('button', { name: 'Open game library' }).click();
};
const isPracticeChunk = url => /\/StudyPractice(?:-[^/]+\.js|\.tsx)$/.test(new URL(url).pathname);

(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const chunks = []; page.on('request', request => { if (isPracticeChunk(request.url())) chunks.push(request.url()); });
      try {
        await setup(page); await page.goto(base + '?moves=h2e2'); await openLibrary(page, width);
        const original = await page.evaluate(() => ({ raw: localStorage.getItem('xiangqi:library:v1'),
          board: [...document.querySelectorAll('.board-stage .hitbox')].map(node => node.getAttribute('aria-label')) }));
        assert.equal(chunks.length, 0, 'Practice code must load on demand');
        const trigger = page.getByTestId('practice-saved-repertoire'); await trigger.click();
        const dialog = page.getByTestId('study-practice-dialog');
        const close = dialog.getByRole('button', { name: 'Close study practice' });
        const progress = page.getByTestId('study-practice-progress'); await progress.waitFor();
        assert.ok(chunks.length > 0);
        assert.equal(await close.evaluate(node => node === document.activeElement), true);
        const notes = dialog.getByTestId('study-practice-line-notes');
        const checkNotes = async expected => {
          await notes.waitFor();
          assert.equal(await notes.locator('li').count(), 0, 'Collapsed notes should not render the full annotation list');
          await notes.locator('summary').focus();
          await page.keyboard.press('Enter');
          await notes.locator('li').first().waitFor();
          assert.deepEqual(await notes.locator('li p').allTextContents(), ['Opening plan <b>literal text</b>', ...expected]);
          assert.equal(await notes.locator('b').count(), 0, 'Study text must not be interpreted as markup');
          assert.match(await notes.locator('li strong').first().innerText(), /Start position/);
        };
        const commonNote = 'Keep this note ' + '準備'.repeat(100);
        assert.equal(await notes.count(), 0, 'Study notes must not reveal future moves before completion');
        const move = async uci => {
          for (const square of [uci.slice(0, 2), uci.slice(2)]) await dialog.locator(`.hitbox[data-file="${square.charCodeAt(0) - 97}"][data-rank="${square[1]}"]`).click();
        };
        await move('a3a4');
        assert.match(await dialog.getByTestId('study-practice-status').innerText(), /legal, but outside/);
        assert.match(await dialog.locator('.hitbox[data-file="0"][data-rank="3"]').getAttribute('aria-label'), /red soldier/);
        await dialog.getByRole('button', { name: 'Show a saved move' }).click();
        assert.match(await dialog.getByTestId('study-practice-hint').innerText(), /h2→e2/i);
        await move('h2e2');
        assert.equal(await notes.count(), 0);
        await dialog.getByRole('button', { name: 'Play saved reply' }).click();
        assert.equal(await dialog.evaluate(node => Boolean(node.querySelector('.study-practice-board')?.contains(document.activeElement))), true);
        assert.equal(await notes.count(), 0);
        await move('h0g2');
        await checkNotes([commonNote, 'Right horse reply', 'Develop the right horse']);
        assert.match(await progress.innerText(), /1 of 3/);
        assert.match(await dialog.getByTestId('study-practice-recall').innerText(), /1 of 2/);
        await dialog.getByRole('button', { name: 'Next line' }).click();
        assert.equal(await notes.count(), 0, 'Starting another line must hide the previous notes');
        // A different saved Red branch is accepted, not labeled a mistake.
        await move('b2e2'); await dialog.getByRole('button', { name: 'Play saved reply' }).click();
        assert.match(await progress.innerText(), /2 of 3/);
        await checkNotes(['Other cannon', 'Other line reply']);
        await dialog.getByRole('button', { name: 'Next line' }).click();
        await move('h2e2'); await dialog.getByRole('button', { name: 'Play saved reply' }).click(); await move('b0c2');
        assert.match(await progress.innerText(), /3 of 3/);
        await checkNotes([commonNote, 'Left horse reply', 'Develop the left horse']);
        await dialog.getByRole('button', { name: 'Practice again' }).waitFor();
        await dialog.getByRole('combobox', { name: 'Practice as' }).selectOption('b');
        assert.match(await progress.innerText(), /0 of 3/);
        assert.equal(await notes.count(), 0, 'Changing sides must hide completed-line notes');
        await dialog.getByRole('button', { name: 'Play saved reply' }).click();
        await move('b9c7'); await dialog.getByRole('button', { name: 'Play saved reply' }).click();
        assert.match(await progress.innerText(), /1 of 3/);
        await checkNotes([commonNote, 'Left horse reply', 'Develop the left horse']);
        // Dialog shortcuts must not navigate or flip the actual study behind it.
        await close.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('f');
        const current = await page.evaluate(() => ({ raw: localStorage.getItem('xiangqi:library:v1'),
          board: [...document.querySelectorAll('.board-stage .hitbox')].map(node => node.getAttribute('aria-label')) }));
        assert.deepEqual(current, original);
        for (const fontSize of [16, 32]) {
          await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, fontSize);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await close.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/xiangqi-study-practice-${browserType.name()}-${width}-${fontSize}.png` });
          assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.equal(await notes.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'Long notes overflow the panel');
          const buttons = await dialog.locator('button:not(.hitbox)').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
          assert.ok(buttons.every(height => height >= 43.99));
          const clipped = await dialog.locator('button:not(.hitbox)').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map(node => ({ text: node.textContent, width: node.clientWidth, scrollWidth: node.scrollWidth, height: node.clientHeight, scrollHeight: node.scrollHeight })));
          assert.deepEqual(clipped, [], 'Practice controls must contain their enlarged labels');
          const selection = await dialog.getByRole('combobox', { name: 'Practice as' }).evaluate(select => {
            const style = getComputedStyle(select);
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const text = select.selectedOptions[0].text;
            // app-select reserves its chevron in the computed end padding.
            const needed = context.measureText(text).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            return { text, needed, available: select.clientWidth };
          });
          assert.ok(selection.available >= selection.needed, 'Selected practice side is truncated: ' + JSON.stringify(selection));
          for (const control of await dialog.locator('button:not(.hitbox), select').all()) {
            await control.scrollIntoViewIfNeeded();
            assert.equal(await control.evaluate(node => {
              const rect = node.getBoundingClientRect();
              return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
            }), true, 'Practice control is covered or unreachable');
          }
          if (fontSize === 32) await dialog.locator('.study-practice-controls').screenshot({ path: `/tmp/xiangqi-practice-controls-${browserType.name()}-${width}.png` });
          if (fontSize === 32 && width === 320) {
            // Inspect the whole expanded notes card separately from the short
            // viewport assertions above, then restore the actual device size.
            await page.setViewportSize({ width, height: 2600 });
            await notes.screenshot({ path: `/tmp/xiangqi-practice-notes-${browserType.name()}-${width}.png` });
            await page.setViewportSize({ width, height });
          }
        }
        await dialog.getByRole('button', { name: 'Restart line' }).click();
        assert.equal(await notes.count(), 0, 'Restarting must hide completed-line notes');
        await close.focus(); await page.keyboard.press('Shift+Tab');
        assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
        await page.evaluate(() => document.documentElement.style.fontSize = '16px');
        await page.getByTestId('practice-saved-black-root').click();
        await dialog.getByRole('combobox', { name: 'Practice as' }).waitFor();
        assert.equal(await dialog.getByRole('combobox', { name: 'Practice as' }).inputValue(), 'b');
        await move('h9g7');
        assert.match(await progress.innerText(), /1 of 1/);
        assert.equal(await notes.count(), 0, 'An unannotated game must not show an empty notes section');
        await close.click();
        await page.getByTestId('practice-saved-invalid').click();
        await dialog.getByRole('alert').waitFor();
        assert.match(await dialog.getByRole('alert').innerText(), /illegal/);
        await close.click();
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: all branches, both sides, hints/recall, unchanged study, focus, lazy loading and 100/200% layout passed`);
      } finally { await page.close(); }
    }
    const failed = await browser.newPage();
    await setup(failed);
    await failed.route(url => isPracticeChunk(url.href), route => route.abort());
    await failed.goto(base); await openLibrary(failed, 1440);
    const trigger = failed.getByTestId('practice-saved-repertoire'); await trigger.click();
    await failed.getByTestId('study-practice-dialog').getByRole('alert').waitFor();
    await failed.getByRole('button', { name: 'Close study practice' }).click();
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    assert.equal(await failed.locator('.board-stage .hitbox').count(), 90);
    await failed.close();
    console.log(`${browserType.name()}: a failed practice chunk leaves the board and close action available`);
    const ai = await browser.newPage();
    await setup(ai); await ai.addInitScript(() => { window.__holdAiMove = true; });
    await ai.goto(base + '?moves=h2e2&mode=PvAI-Black');
    await ai.getByRole('button', { name: 'Open game library' }).waitFor();
    await ai.keyboard.press('ControlOrMeta+k');
    await ai.getByRole('combobox', { name: 'Search commands' }).fill('Settings'); await ai.keyboard.press('Enter');
    await ai.evaluate(() => { window.__goCount = 0; });
    await ai.locator('#settings-workspace-mode').selectOption('play');
    await ai.getByRole('button', { name: 'Close settings', exact: true }).click();
    await ai.waitForFunction(() => window.__goCount > 0);
    const beforeAi = await ai.locator('.board-stage .hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    await openLibrary(ai, 1440); await ai.getByTestId('practice-saved-repertoire').click();
    await ai.getByTestId('study-practice-progress').waitFor();
    await ai.evaluate(() => window.__releaseAiMove());
    await ai.getByRole('button', { name: 'Close study practice' }).click();
    assert.deepEqual(await ai.locator('.board-stage .hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), beforeAi);
    await ai.close();
    console.log(`${browserType.name()}: opening practice pauses an AI game and ignores its late move`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
