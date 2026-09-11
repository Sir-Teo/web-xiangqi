const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label).catch(async error => {
    console.error('Dialogs at command failure:', await page.getByRole('dialog').allTextContents());
    throw error;
  });
  await page.keyboard.press('Enter');
}
const fake = `
window.__depth = 18; window.__score = 75; window.__pv = 'h2e2 h9g7 h0g2';
window.Pikafish = function() {};
window.Pikafish.createWorkerEngine = async () => {
  const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
  let position = '';
  return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
    postMessage(command) {
      if (command.startsWith('position ')) position = command;
      if (command === 'uci') queueMicrotask(() => { emit('id name Pikafish QA 2026'); emit('uciok'); });
      if (command === 'isready') queueMicrotask(() => emit('readyok'));
      if (command.startsWith('go ')) queueMicrotask(() => {
        const line = position === 'position startpos' ? window.__pv : 'a9a8 a0a1';
        emit('info depth ' + window.__depth + ' multipv 1 score cp ' + window.__score + ' pv ' + line);
        emit('bestmove ' + line.split(' ')[0]);
      });
      if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
    }
  };
};`;

async function check(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  try {
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async text => { window.__copied = text; } } }));
    await context.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: fake }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.keyboard.press('e');
    const keep = page.getByTestId('keep-engine-pv-0');
    await keep.waitFor();
    const boardState = () => page.locator('.hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    const root = await boardState();
    await keep.click();
    assert.equal(await keep.isDisabled(), true);
    await page.keyboard.press('t');
    const card = page.getByTestId('saved-analysis-card');
    await card.waitFor();
    assert.match(await card.locator('summary').first().innerText(), /\+0.75 Red POV · D18/);
    await card.locator('summary').first().click();
    assert.match(await card.innerText(), /Pikafish QA 2026/);
    assert.match(await card.innerText(), /single-simd · 1 thread/);
    await card.locator('details summary').click();
    assert.equal(await card.locator('code').innerText(), 'position startpos');
    assert.deepEqual(await boardState(), root);
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      assert.ok((await card.getByRole('button', { name: 'View source position' }).boundingBox()).height >= 44);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await card.screenshot({ path: `/tmp/xiangqi-study-analysis-${browserType.name()}-${width}.png` });

    // Reanalysis only replaces the snapshot after explicitly updating it.
    await page.keyboard.press('e');
    await page.evaluate(() => { window.__depth = 26; window.__score = 100; });
    await page.getByTestId('deep-dive-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="keep-engine-pv-0"]')?.textContent.includes('Update analysis'));
    await page.keyboard.press('t');
    assert.match(await card.locator('summary').first().innerText(), /D18/);
    await page.keyboard.press('e');
    await keep.click();
    await page.keyboard.press('t');
    assert.match(await card.locator('summary').first().innerText(), /\+1.00 Red POV · D26/);
    assert.equal(await page.locator('.mtree-chip').count(), 3, 'Updating analysis duplicated moves');
    await command(page, 'Save game');
    let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
    assert.deepEqual(saved.moves, []);
    assert.equal(saved.moveTree[0].analysis.score, 100);
    assert.equal(saved.moveTree[0].analysis.depth, 26);
    assert.equal(saved.moveTree[0].evalScore, undefined);
    const snapshot = saved.moveTree[0].analysis;

    // A snapshot-only straight line must survive saving and sharing at its tip.
    await page.locator('.mtree-chip').last().click();
    await command(page, 'Save game');
    saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
    assert.deepEqual(saved.moveTree[0].analysis, snapshot);
    await command(page, 'Copy link');
    const url = await page.evaluate(() => window.__copied);
    assert.ok(new URL(url).searchParams.has('tree'));
    // This recipient shares browser storage with the sender. Wait for the
    // autosave explicitly so the recovery choice cannot depend on timing.
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moves.length === 3);
    const recipient = await context.newPage();
    recipient.on('pageerror', error => errors.push(error.message));
    await recipient.goto(url);
    await recipient.getByRole('button', { name: "Keep the link's game", exact: true }).click();
    await command(recipient, 'Go to start');
    await recipient.keyboard.press('t');
    assert.match(await recipient.getByTestId('saved-analysis-card').innerText(), /D26/);
    await recipient.close();

    // PGN round-trip carries source metadata through the normal import dialog.
    await command(page, 'Go to start');
    const downloadReady = page.waitForEvent('download');
    await command(page, 'Download PGN');
    const chunks = [];
    for await (const chunk of await (await downloadReady).createReadStream()) chunks.push(chunk);
    const pgn = Buffer.concat(chunks).toString();
    assert.ok(pgn.includes('[%xqanalysis '));
    if (width < 900) await page.getByTestId('mobile-view-board').click();
    await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
    await page.getByTestId('uci-line-input').fill(pgn);
    await page.getByTestId('import-uci-line-btn').click();
    await command(page, 'Go to start');
    await page.keyboard.press('t');
    assert.match(await card.innerText(), /D26/);
    await command(page, 'Save game');
    saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
    assert.deepEqual(saved.moveTree[0].analysis, snapshot);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.[0]?.analysis?.depth === 26);
    await page.reload();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.keyboard.press('t');
    assert.match(await card.innerText(), /D26/);
    assert.deepEqual(await boardState(), root);

    // Infinite searches may exceed depth 128. Updating that snapshot must
    // preserve the user's note and retain the depth through recovery.
    const note = 'Keep pressure on the centre. 保留计划。';
    await page.locator('.mtree-chip').first().click();
    await page.getByTestId('move-comment-input').fill(note);
    await command(page, 'Go to start');
    await page.keyboard.press('e');
    await page.evaluate(() => { window.__depth = 245; window.__score = 100; });
    await page.getByTestId('deep-dive-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="keep-engine-pv-0"]')?.textContent.includes('Update analysis'));
    await keep.click();
    await page.keyboard.press('t');
    assert.match(await card.innerText(), /D245/);
    await page.locator('.mtree-chip').first().click();
    await page.waitForFunction(note => document.querySelector('[data-testid="move-comment-input"]')?.value === note, note);
    assert.equal(await page.getByTestId('move-comment-input').inputValue(), note);
    await command(page, 'Go to start');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.[0]?.analysis?.depth === 245);
    await page.reload();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.keyboard.press('t');
    assert.match(await card.innerText(), /D245/);
    assert.deepEqual(await boardState(), root);

    // Same placement without the stored history is not the same source search.
    await page.addInitScript(() => {
      const saved = JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1'));
      saved.game.moveTree[0].analysis.position = 'position startpos moves a0a1 a9a8 a1a0 a8a9';
      localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify(saved));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.keyboard.press('t');
    assert.equal(await card.count(), 0, 'A snapshot from different history was assigned to this source');
    assert.equal(await page.locator('.mtree-chip').count(), 3, 'Rejecting metadata discarded legal study moves');
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: analysis snapshot capture/update, deep-search depth, notes, source history, save/share/PGN/reload and layout passed at ${width}px`);
  } finally { await context.close(); }
}
async function checkRealEngine(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.keyboard.press('e');
    await page.getByTestId('keep-engine-pv-0').click({ timeout: 120_000 });
    await command(page, 'Save game');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
    const snapshot = saved.moveTree[0].analysis;
    assert.ok(snapshot.depth > 0);
    assert.match(snapshot.engine.name, /^Pikafish /);
    assert.ok(!snapshot.engine.name.includes('not reported'));
    assert.match(snapshot.engine.variant, /^(single|threaded)/);
    assert.ok(snapshot.engine.threads >= 1);
    assert.ok(snapshot.engine.hashMB > 0);
    assert.equal(snapshot.position, 'position startpos');
    assert.equal(snapshot.move, saved.moveTree[0].uci);
    assert.equal(saved.moveTree[0].evalScore, undefined);
    assert.deepEqual(saved.moves, []);
    await page.keyboard.press('t');
    const card = page.getByTestId('saved-analysis-card');
    await card.locator('summary').first().click();
    assert.ok((await card.innerText()).includes(snapshot.engine.name));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await card.screenshot({ path: `/tmp/xiangqi-study-analysis-real-${browserType.name()}-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: real engine snapshot passed at ${width}px (${snapshot.engine.name}, ${snapshot.engine.variant}, ${snapshot.engine.threads} threads, ${snapshot.engine.hashMB} MB)`);
  } finally { await context.close(); }
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) await check(browser, width);
    if (process.env.XIANGQI_QA_REAL_ANALYSIS === '1') {
      for (const width of [1440, 390]) await checkRealEngine(browser, width);
    }
  }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
