const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function setHidden(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await page.waitForTimeout(100);
}

async function saveSnapshot(page) {
  const count = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Save game');
  await page.keyboard.press('Enter');
  await page.waitForFunction(count => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === count + 1, count);
  return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
}

async function compare(browser, width, real = false) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text; } } });
    });
    if (!real) await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.__commands = [];
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = [];
        const emit = line => listeners.forEach(listener => listener(line));
        window.__emit = emit;
        let position = '';
        return {
          variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
          postMessage(command) {
            window.__commands.push(command);
            if (command.startsWith('position ')) position = command;
            if (command === 'uci') queueMicrotask(() => emit('uciok'));
            if (command === 'isready') queueMicrotask(() => emit('readyok'));
            if (command.startsWith('go ')) queueMicrotask(() => {
              const roots = command.split(' searchmoves ')[1]?.split(' ');
              if (roots) {
                roots.forEach((root, i) => emit('info depth 12 multipv ' + (i + 1) + ' score cp ' + (9999 - i) + (i === 0 ? window.__candidateBound || '' : '') + ' pv ' +
                  (root === 'a9a8' ? 'a9a8 a0a1 i9i8' : 'i9i8 i0i1 a9a8')));
                if (!command.includes('infinite') && !window.__holdStop) emit('bestmove ' + roots[0]);
              } else {
                const move = position === 'position startpos' ? 'h2e2' : 'h9g7';
                emit('info depth 12 multipv 1 score cp 30 pv ' + move);
                emit('bestmove ' + move);
              }
            });
            if (command === 'stop' && !window.__holdStop) queueMicrotask(() => emit('bestmove (none)'));
          }
        };
      };
    ` }));
    await page.goto(base + '?moves=h2e2');
    await page.locator('.xiangqi-board').waitFor();
    const evalSelector = width < 900 ? '.mobile-eval-chip' : '.eval-bar-readout';
    if (!real) await page.waitForFunction(selector => Number(document.querySelector(selector)?.textContent) === -0.3, evalSelector);
    await page.keyboard.press('e');
    const open = page.getByTestId('open-candidate-comparison');
    await page.waitForFunction(() => document.querySelector('[data-testid="open-candidate-comparison"]')?.disabled === false, null, { timeout: 60000 });
    const boardState = () => page.locator('.hitbox').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')));
    const initial = await boardState();
    if (width === 320) {
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox', { name: 'Search commands' }).fill('Compare candidate moves');
      await page.keyboard.press('Enter');
    } else await open.click();
    const panel = page.getByTestId('candidate-panel');
    const select = panel.getByLabel('Candidate move', { exact: true });
    assert.equal(await select.evaluate(el => el === document.activeElement), true);
    assert.equal(await panel.getByTestId('compare-candidates').isDisabled(), true);
    assert.equal(await select.locator('option[value="a0a1"]').count(), 0, 'Off-turn move offered');
    for (const move of ['a9a8', 'i9i8']) {
      await select.selectOption(move);
      await panel.getByRole('button', { name: 'Add move', exact: true }).click();
      assert.equal(await select.locator(`option[value="${move}"]`).isDisabled(), true);
    }
    if (!real) await page.evaluate(() => { window.__candidateBound = ' lowerbound'; });
    await panel.getByTestId('compare-candidates').click();
    await page.getByTestId('candidate-line-a9a8').waitFor({ timeout: 60000 });
    await page.getByTestId('candidate-line-i9i8').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="candidate-results"]')?.textContent.includes('Comparison finished.'), null, { timeout: 60000 });
    assert.equal(await page.locator('[data-testid="engine-pv-line-0"]').count(), 0);
    assert.deepEqual(await boardState(), initial);
    if (!real) {
      await setHidden(page, true);
      await setHidden(page, false);
      assert.equal(await page.getByTestId('candidate-line-a9a8').count(), 1, 'Hiding discarded a finished comparison');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (!real) {
      assert.match(await panel.innerText(), /-100\.0 Red POV/);
      assert.match(await page.getByTestId('candidate-line-a9a8').locator('.candidate-heading').innerText(), /Not exact/, 'A bounded candidate must identify its uncertainty');
      assert.doesNotMatch(await page.getByTestId('candidate-line-i9i8').locator('.candidate-heading').innerText(), /Not exact/, 'An exact candidate must not inherit another line’s bound');
      if (width < 900) await page.getByTestId('mobile-view-board').click();
      if (width < 900) assert.equal(await page.locator(evalSelector).count(), 0, 'A restricted score must not become a live board chip');
      else assert.equal(await page.locator(evalSelector).textContent(), '—', 'The live position reading must stay paused during candidate comparison');
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox', { name: 'Search commands' }).fill('Evaluation graph');
      await page.keyboard.press('Enter');
      await page.locator('.graph-wrap').waitFor();
      assert.equal(await page.locator('.graph-legend strong').textContent(), 'Red POV -0.30', 'Restricted score changed historical evaluation');
      await page.keyboard.press('e');
      for (const size of [16, 32, 16]) {
        await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const first = page.getByTestId('candidate-line-a9a8');
        assert.equal(await first.locator('.candidate-heading').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, 'Candidate uncertainty must fit with enlarged text');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (size === 32) await first.screenshot({ path: `/tmp/xiangqi-candidate-bound-${browserType.name()}-${width}.png` });
      }
      const commands = await page.evaluate(() => window.__commands);
      const go = commands.findLastIndex(command => command.includes(' searchmoves '));
      assert.match(commands[go], /^go depth \d+ movetime \d+ searchmoves a9a8 i9i8$/);
      assert.equal(commands.slice(0, go).findLast(command => command.startsWith('position ')), 'position startpos moves h2e2');
      assert.equal(commands.slice(0, go).findLast(command => command.startsWith('setoption name MultiPV')), 'setoption name MultiPV value 2');
      await page.getByTestId('copy-candidate-a9a8').click();
      assert.equal(await page.evaluate(() => window.__copied), 'a9a8 a0a1 i9i8');
      // Clipboard denial must not report success; a later retry can recover.
      await page.evaluate(() => {
        window.__writeClipboard = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); };
        document.execCommand = () => false;
        window.__copied = '';
      });
      await page.getByTestId('copy-candidate-a9a8').click();
      assert.equal(await page.getByTestId('copy-candidate-a9a8').innerText(), 'Copy failed');
      assert.equal(await page.evaluate(() => window.__copied), '');
      await page.evaluate(() => { navigator.clipboard.writeText = window.__writeClipboard; });
      await page.getByTestId('copy-candidate-a9a8').click();
      assert.equal(await page.getByTestId('copy-candidate-a9a8').innerText(), 'Copied');
      assert.equal(await page.evaluate(() => window.__copied), 'a9a8 a0a1 i9i8');
    }
    for (const move of ['a9a8', 'i9i8']) {
      const keep = page.getByTestId(`keep-candidate-${move}`);
      await keep.click();
      assert.equal(await keep.isDisabled(), true);
    }
    assert.deepEqual(await boardState(), initial, 'Keep moved the board');
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const undersized = await panel.locator('button, select').evaluateAll(elements => elements.filter(el => {
        const r = el.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44);
      }).map(el => el.outerHTML));
      assert.deepEqual(undersized, []);
    }
    await panel.screenshot({ path: `/tmp/xiangqi-candidates-${browserType.name()}-${width}-${real ? 'real' : 'controlled'}.png` });
    if (!real) {
      const saved = await saveSnapshot(page);
      assert.deepEqual(saved.moves, ['h2e2']);
      const treeLine = node => [node.uci, ...(node.children?.length ? treeLine(node.children[0]) : [])];
      assert.deepEqual(saved.moveTree[0].children.map(treeLine), [['a9a8', 'a0a1', 'i9i8'], ['i9i8', 'i0i1', 'a9a8']]);
      assert.notEqual(Math.abs(saved.finalEval || 0), 9999, 'Restricted score became the position evaluation');
      assert.equal(saved.moveTree[0].children[0].evalScore, undefined, 'Snapshot became a move evaluation');
      assert.equal(saved.moveTree[0].children[0].analysis.score, -9999);
      assert.equal(saved.moveTree[0].children[0].analysis.bounded, true, 'Saving discarded the candidate bound');
      assert.equal(saved.moveTree[0].children[0].analysis.bound, 'upper', 'Black’s lower bound must become an upper bound for Red');
      assert.deepEqual(saved.moveTree[0].children[0].analysis.candidates, ['a9a8', 'i9i8']);
    }
    if (!real) await page.evaluate(() => { window.__candidateBound = ''; });
    await page.getByTestId('deep-dive-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="candidate-results"]')?.textContent.includes('Comparison finished.'), null, { timeout: 60000 });
    if (!real) assert.match((await page.evaluate(() => window.__commands)).findLast(command => command.startsWith('go ')), /searchmoves a9a8 i9i8$/);
    if (!real) {
      assert.doesNotMatch(await page.getByTestId('candidate-line-a9a8').locator('.candidate-heading').innerText(), /Not exact/, 'An exact result must clear the bound label');
      const update = page.getByTestId('keep-candidate-a9a8');
      assert.equal(await update.innerText(), 'Update analysis', 'A same-score exact result must be available to save');
      await update.click();
      const exact = (await saveSnapshot(page)).moveTree[0].children[0].analysis;
      assert.equal(exact.bounded, false);
      assert.equal(exact.bound, undefined);
    }
    if (!real) {
      await page.evaluate(() => { window.__holdStop = true; });
      await panel.getByTestId('compare-candidates').click();
      await panel.getByRole('button', { name: 'Stop comparison', exact: true }).waitFor();
      await page.getByTestId('deep-dive-btn').click();
      if (width === 390) await page.keyboard.press('d');
      else if (width === 320) {
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Stop deep search');
        await page.keyboard.press('Enter');
      } else await page.getByTestId('deep-dive-btn').click();
      const beforeRelease = await page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length);
      await page.evaluate(() => { window.__holdStop = false; window.__emit('bestmove a9a8'); });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length), beforeRelease, 'Cancelled queued comparison started after Stop');
    }
    if (!real) {
      await page.evaluate(() => { window.__holdStop = true; });
      await page.getByTestId('deep-dive-btn').click();
      await panel.getByRole('button', { name: 'Stop comparison', exact: true }).waitFor();
      const beforeHidden = await page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length);
      await setHidden(page, true);
      await page.evaluate(() => { window.__holdStop = false; window.__emit('bestmove a9a8'); });
      await page.waitForTimeout(100);
      await setHidden(page, false);
      assert.equal(await page.evaluate(() => window.__commands.filter(command => command.startsWith('go ')).length), beforeHidden, 'Returning replaced the completed deep search');
      assert.equal(await page.getByTestId('candidate-line-a9a8').count(), 1, 'A deep comparison finishing in the background lost its result');
    }
    if (!real) {
      // Live comparisons stop when hidden, including a delayed stop acknowledgement.
      await page.evaluate(() => { window.__holdStop = true; });
      await panel.getByTestId('compare-candidates').click();
      await panel.getByRole('button', { name: 'Stop comparison', exact: true }).waitFor();
      const stopCount = await page.evaluate(() => window.__commands.filter(command => command === 'stop').length);
      await setHidden(page, true);
      assert.equal(await page.evaluate(() => window.__commands.filter(command => command === 'stop').length), stopCount + 1);
      await page.evaluate(() => { window.__holdStop = false; window.__emit('bestmove a9a8'); });
      await setHidden(page, false);
      assert.equal(await page.getByTestId('candidate-results').count(), 0);
      await page.getByTestId('engine-pv-line-0').waitFor();
      await panel.getByTestId('compare-candidates').click();
      await page.getByTestId('candidate-line-a9a8').waitFor();
    }
    await page.getByTestId('deep-infinite-toggle').click();
    await page.getByTestId('deep-dive-btn').click();
    await panel.getByRole('button', { name: 'Stop comparison', exact: true }).waitFor();
    if (!real) {
      await page.waitForFunction(() => window.__commands.includes('go infinite searchmoves a9a8 i9i8'));
    }
    await panel.getByRole('button', { name: 'Stop comparison', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="candidate-results"]')?.textContent.includes('Comparison finished.'));
    await page.getByTestId('deep-infinite-toggle').click();
    await panel.getByRole('button', { name: 'Remove candidate a9a8' }).click();
    assert.equal(await page.getByTestId('candidate-results').count(), 0);
    await page.getByTestId('engine-pv-line-0').waitFor({ timeout: 60000 });
    await panel.getByTestId('compare-candidates').click();
    await page.getByTestId('candidate-line-i9i8').waitFor({ timeout: 60000 });
    await page.getByTestId('candidate-i9i8-move-0').click();
    await panel.waitFor({ state: 'detached' });
    assert.match(await page.locator('.hitbox[data-file="8"][data-rank="8"]').getAttribute('aria-label'), /black chariot/);
    await open.click();
    const available = await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
    for (const move of available.slice(0, 5)) {
      await select.selectOption(move);
      await panel.getByRole('button', { name: 'Add move', exact: true }).click();
    }
    assert.equal(await select.isDisabled(), true);
    assert.match(await panel.getByRole('status').innerText(), /5 of 5 selected/);
    await page.getByRole('button', { name: 'Close candidate comparison' }).click();
    assert.equal(await open.evaluate(el => el === document.activeElement), true);
    assert.deepEqual(errors, []);
    console.log(`Candidate comparison ${real ? 'real engine' : 'controlled'} passed at ${width}px`);
  } catch (error) {
    await page.screenshot({ path: `/tmp/xiangqi-candidates-failure-${browserType.name()}-${width}.png` });
    console.error(await page.locator('body').innerText());
    throw error;
  } finally { await page.close(); }
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) await compare(browser, width);
    if (process.env.XIANGQI_QA_REAL_CANDIDATES === '1') await compare(browser, 1440, true);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
