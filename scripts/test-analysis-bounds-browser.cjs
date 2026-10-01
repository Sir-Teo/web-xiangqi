const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function install(page, errors) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async text => { window.__copied = text; } } }));
  await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.__boundScore = 'cp 150 lowerbound';
    window.Pikafish = function() {};
    window.Pikafish.createWorkerEngine = async () => {
      const listeners = []; const emit = line => listeners.forEach(listener => listener(line)); let position = '';
      return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
        if (command === 'uci') queueMicrotask(() => { emit('id name Pikafish Bounds QA'); emit('uciok'); });
        if (command === 'isready') queueMicrotask(() => emit('readyok'));
        if (command.startsWith('position ')) position = command;
        if (command.startsWith('go ')) queueMicrotask(() => {
          const plies = position.includes(' moves ') ? position.split(' moves ')[1].trim().split(/ +/).length : 0;
          const line = plies % 2 ? 'a9a8 a0a1' : 'h2e2 h9g7';
          emit('info depth 18 multipv 1 score ' + window.__boundScore + ' pv ' + line);
          emit('bestmove ' + line.split(' ')[0]);
        });
        if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
      } };
    };` }));
}
async function savedAnalysis(page) {
  const previous = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
  await command(page, 'Save game');
  await page.waitForFunction(previous => localStorage.getItem('xiangqi:library:v1') !== previous, previous);
  return page.evaluate(() => {
    const game = JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1);
    const stack = [...game.moveTree]; const analyses = [];
    while (stack.length) { const node = stack.pop(); if (node.analysis) analyses.push(node.analysis); stack.push(...node.children || []); }
    return analyses;
  });
}
async function showCard(page) {
  await page.keyboard.press('t');
  const card = page.getByTestId('saved-analysis-card');
  await card.waitFor();
  if (await card.getAttribute('open') === null) await card.locator(':scope > summary').click();
  return card;
}
async function checkCollapsedSummary(page, card, bound) {
  const summary = card.locator(':scope > summary');
  if (await card.getAttribute('open') !== null) {
    await summary.focus(); await page.keyboard.press('Enter');
  }
  assert.equal(await card.getAttribute('open'), null);
  const text = await summary.innerText();
  if (bound) {
    const label = bound === 'lower' ? 'Lower bound' : bound === 'upper' ? 'Upper bound' : 'Bound';
    assert.ok(text.includes(`${label}, not exact`), `Collapsed snapshot hides uncertainty: ${text}`);
    if (bound === 'unknown') assert.doesNotMatch(text, /Lower bound|Upper bound/);
  } else assert.doesNotMatch(text, /bound|not exact/i, 'An exact replacement retains a stale summary qualifier');
  await summary.focus(); await page.keyboard.press('Enter');
  assert.notEqual(await card.getAttribute('open'), null);
}
async function sourceCard(page, black) {
  await command(page, 'Go to start');
  if (black) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowRight');
  }
  return showCard(page);
}
async function importPgn(page, width, pgn) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  await page.getByTestId('uci-line-input').fill(pgn);
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 320]) for (const black of [false, true]) {
      const options = { viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' };
      const page = await browser.newPage(options); const errors = [];
      let recipient;
      try {
        await install(page, errors);
        await page.goto(base + (black ? '?moves=h2e2' : ''));
        await page.getByTestId('start-engine-analysis').click();
        await page.locator('.xiangqi-board').waitFor();
        const boardState = () => page.locator('.hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
        const before = await boardState();
        let snapshot;
        for (const [wire, score, rawBound] of [['cp 150 lowerbound', 150, 'lower'], ['cp 150 upperbound', 150, 'upper'], ['cp 150', 150, undefined], ['mate 3 lowerbound', 29997, 'lower']]) {
          await page.keyboard.press('e');
          await page.evaluate(score => { window.__boundScore = score; }, wire);
          await page.getByTestId('deep-dive-btn').click();
          await page.waitForFunction(() => {
            const button = document.querySelector('[data-testid="keep-engine-pv-0"]');
            return button && !button.disabled;
          });
          await page.getByTestId('keep-engine-pv-0').click();
          const analyses = await savedAnalysis(page);
          assert.equal(analyses.length, 1);
          snapshot = analyses[0];
          const bound = rawBound && black ? rawBound === 'lower' ? 'upper' : 'lower' : rawBound;
          assert.equal(snapshot.bound, bound, `${black ? 'Black' : 'Red'} ${wire}: snapshot has the wrong perspective or retained a stale bound`);
          assert.equal(snapshot.bounded, Boolean(rawBound));
          assert.equal(snapshot.score, black ? -score : score);
          assert.deepEqual(await boardState(), before, 'Saving analysis moved the board');
          const card = await showCard(page);
          await checkCollapsedSummary(page, card, bound);
          const label = bound ? `${bound === 'lower' ? 'Lower' : 'Upper'} bound, not an exact score` : 'Exact search score';
          assert.ok((await card.innerText()).includes(label));
        }
        const card = page.getByTestId('saved-analysis-card');
        for (const size of [16, 32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const clipped = await card.locator('dd, p, summary').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
          assert.deepEqual(clipped, []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          if (size === 32) await card.screenshot({ path: `/tmp/xiangqi-analysis-bounds-${browserType.name()}-${width}-${black ? 'black' : 'red'}.png` });
          if (size === 32) {
            const summary = card.locator(':scope > summary');
            await summary.focus(); await page.keyboard.press('Enter');
            assert.equal(await summary.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
            await card.screenshot({ path: `/tmp/xiangqi-analysis-summary-${browserType.name()}-${width}-${black ? 'black' : 'red'}.png` });
            await page.keyboard.press('Enter');
          }
        }
        await command(page, 'Go to start');
        await command(page, 'Copy PGN');
        const pgn = await page.evaluate(() => window.__copied);
        assert.equal(JSON.parse(decodeURIComponent(pgn.match(/\[%xqanalysis ([^\]\s]+)\]/)[1])).bound, snapshot.bound);
        await command(page, 'Copy link');
        const link = await page.evaluate(() => window.__copied);
        recipient = await browser.newPage(options);
        await install(recipient, errors);
        await recipient.goto(link);
        await recipient.locator('.xiangqi-board').waitFor();
        const expected = `${snapshot.bound === 'lower' ? 'Lower' : 'Upper'} bound, not an exact score`;
        const sharedCard = await sourceCard(recipient, black);
        await checkCollapsedSummary(recipient, sharedCard, snapshot.bound);
        assert.ok((await sharedCard.innerText()).includes(expected));
        assert.deepEqual(await savedAnalysis(recipient), [snapshot], 'Share loading changed the saved bound');
        await importPgn(recipient, width, pgn);
        const importedCard = await sourceCard(recipient, black);
        await checkCollapsedSummary(recipient, importedCard, snapshot.bound);
        assert.ok((await importedCard.innerText()).includes(expected));
        assert.deepEqual(await savedAnalysis(recipient), [snapshot], 'PGN import changed the saved bound');
        const legacy = { ...snapshot }; delete legacy.bound;
        const legacyPgn = pgn.replace(/\[%xqanalysis [^\]\s]+\]/, '[%xqanalysis ' + encodeURIComponent(JSON.stringify(legacy)) + ']');
        await importPgn(recipient, width, legacyPgn);
        const legacyCard = await sourceCard(recipient, black);
        await checkCollapsedSummary(recipient, legacyCard, 'unknown');
        const legacyText = await legacyCard.innerText();
        assert.ok(legacyText.includes('Bound, not an exact score'));
        assert.doesNotMatch(legacyText, /Lower bound|Upper bound/);
        assert.deepEqual(await savedAnalysis(recipient), [legacy], 'An older bounded snapshot acquired an invented direction');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px/${black ? 'Black' : 'Red'}: directional cp/mate bounds, same-score updates, exact recovery, save/share/PGN and enlarged metadata pass`);
      } finally { await recipient?.close(); await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
