const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const fixture = '{Root plan} 1.h2e2 {Old main} (1.b2e2 {Chosen line} b9c7 {Chosen reply}) h9g7 {Old reply} (1...b9c7 {Nested alternative}) *';
async function command(page, label) {
  const savedCount = label === 'Save game' ? await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length) : null;
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  if (savedCount !== null) await page.waitForFunction(count => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === count + 1, savedCount);
}
const move = (page, uci) => page.locator('.mtree-chip').filter({ has: page.locator('.move-uci', { hasText: uci }) });
const line = page => page.locator('.mtree-row .move-uci').allTextContents();
async function expand(page) {
  const panel = page.getByTestId('study-main-line');
  if (!await panel.evaluate(el => el.open)) await panel.locator('summary').click();
  return panel;
}
async function activateMainLineAction(page, testId) {
  const text = page.getByTestId('study-main-line').locator('summary, p');
  const originalSizes = await text.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await page.waitForFunction(sizes => [...document.querySelectorAll('[data-testid="study-main-line"] summary, [data-testid="study-main-line"] p')]
    .every((node, index) => parseFloat(getComputedStyle(node).fontSize) === sizes[index] * 2), originalSizes);
  await text.first().scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const enlargedSizes = await text.evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
  assert.deepEqual(enlargedSizes, originalSizes.map(size => size * 2), 'Main-line summary and guidance must grow with enlarged text');
  assert.equal(await page.getByTestId('study-main-line').evaluate(node => node.scrollWidth > node.clientWidth), false, 'Enlarged main-line text must wrap inside the panel');
  await page.getByTestId(testId).focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const focused = await page.getByTestId('study-main-line').locator('summary').evaluate(node => ({
    summary: node === document.activeElement,
    active: document.activeElement?.outerHTML.slice(0, 180),
    outline: getComputedStyle(node).outlineStyle,
    reachable: (() => { const rect = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); })(),
  }));
  assert.equal(focused.summary, true, `${testId} must leave focus on the persistent main-line summary: ${JSON.stringify(focused)}`);
  assert.equal(focused.reachable, true, `${testId} must reveal the focused summary at 200% text: ${JSON.stringify(focused)}`);
  assert.notEqual(focused.outline, 'none', `${testId} needs a visible focus indicator`);
  await page.screenshot({ path: `/tmp/xiangqi-mainline-focus-${browserType.name()}-${page.viewportSize().width}-${testId}.png` });
  await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function importPgn(page, width, text) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  await page.getByTestId('uci-line-input').fill(text);
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
  await page.keyboard.press('t');
}
async function copyPgn(page) { await command(page, 'Copy PGN'); return page.evaluate(() => window.__copied); }
function pinnedPgn(pgn, primary = 'b2e2', alternative = 'h2e2') {
  assert.ok(pgn.includes('[XiangqiMainLine "1"]'));
  assert.ok(pgn.indexOf(`1. ${primary}`) < pgn.indexOf(`1. ${alternative}`), 'The pinned main line lost PGN priority');
  for (const note of ['Root plan', 'Old main', 'Chosen line', 'Chosen reply', 'Old reply', 'Nested alternative']) assert.ok(pgn.includes(note), `Missing ${note}`);
}
async function install(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } }));
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
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : width === 390 ? 844 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await install(page); await page.goto(base); await importPgn(page, width, fixture);
        await move(page, 'b2e2').click();
        await expand(page);
        const nodeIds = await page.locator('.mtree-chip').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId).sort());
        await activateMainLineAction(page, 'pin-study-main-line');
        assert.equal(await page.getByTestId('pin-study-main-line').isDisabled(), true);
        assert.deepEqual(await page.locator('.mtree-chip').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId).sort()), nodeIds);
        pinnedPgn(await copyPgn(page));
        await move(page, 'h2e2').click(); await move(page, 'h9g7').click();
        pinnedPgn(await copyPgn(page));
        await command(page, 'Save game');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.mainLinePinned, true);
        assert.deepEqual(saved.moves, ['h2e2', 'h9g7']);
        assert.equal(saved.moveTree[0].uci, 'b2e2');
        assert.equal(saved.moveTree[0].children[0].comment, 'Chosen reply');
        await command(page, 'Copy link');
        const url = await page.evaluate(() => window.__copied);
        assert.equal(new URL(url).searchParams.get('main'), '1');
        const recipient = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : width === 390 ? 844 : 900 }, hasTouch: width < 900 });
        try {
          await install(recipient); await recipient.goto(url); await recipient.locator('.xiangqi-board').waitFor(); await recipient.keyboard.press('t');
          await recipient.getByTestId('study-main-line').waitFor();
          assert.deepEqual(await line(recipient), ['h2e2', 'h9g7']);
          pinnedPgn(await copyPgn(recipient));
          await expand(recipient); await activateMainLineAction(recipient, 'open-study-main-line');
          assert.deepEqual(await line(recipient), ['b2e2', 'b9c7']);
        } finally { await recipient.close(); }
        await command(page, 'Library');
        const download = page.waitForEvent('download');
        await page.getByTestId(`download-pgn-saved-${saved.id}`).click();
        const chunks = []; for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        const pgn = Buffer.concat(chunks).toString(); pinnedPgn(pgn);
        await page.getByTestId(`load-saved-${saved.id}`).click(); await page.keyboard.press('t');
        pinnedPgn(await copyPgn(page));
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game?.mainLinePinned === true);
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click(); await page.keyboard.press('t');
        pinnedPgn(await copyPgn(page));
        await importPgn(page, width, pgn);
        await move(page, 'h2e2').click(); await move(page, 'h9g7').click();
        pinnedPgn(await copyPgn(page));
        await command(page, 'Go to study main line');
        assert.deepEqual(await line(page), ['b2e2', 'b9c7']);
        await move(page, 'h2e2').click(); await move(page, 'h9g7').click();
        await command(page, 'Set this as study main line');
        pinnedPgn(await copyPgn(page), 'h2e2', 'b2e2');
        await expand(page);
        for (const button of await page.getByTestId('study-main-line').getByRole('button').all()) {
          const box = await button.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44);
        }
        await page.screenshot({ path: `/tmp/xiangqi-study-main-line-${browserType.name()}-${width}.png` });
        await activateMainLineAction(page, 'unpin-study-main-line');
        await move(page, 'b2e2').click();
        const unpinned = await copyPgn(page);
        assert.ok(!unpinned.includes('[XiangqiMainLine'));
        assert.ok(unpinned.indexOf('1. b2e2') < unpinned.indexOf('1. h2e2'));
        await command(page, 'Save game');
        const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(cleared.mainLinePinned, undefined);
        const count = nodes => (nodes || []).reduce((total, node) => total + 1 + count(node.children), 0);
        assert.equal(count(cleared.moveTree), 5);
        for (const note of ['Root plan', 'Old main', 'Chosen line', 'Chosen reply', 'Old reply', 'Nested alternative']) assert.ok(unpinned.includes(note));

        // Collection import retains the chosen line even after viewing an alternative.
        await command(page, 'Library');
        const collection = page.getByTestId('pgn-collection-import');
        await collection.locator('summary').click();
        const collectionPgn = pgn.replace(/\[Event "[^"\n]*"\]/, '[Event "Main line collection"]');
        await collection.getByLabel('Choose PGN collection').setInputFiles({ name: 'Mainline.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(collectionPgn) });
        await collection.getByRole('button', { name: 'Import 1 game', exact: true }).click();
        await collection.getByRole('status').filter({ hasText: 'Imported 1 game.' }).waitFor();
        const collected = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).find(game => game.metadata?.event === 'Main line collection'));
        assert.equal(collected.mainLinePinned, true);
        await page.getByTestId(`load-saved-${collected.id}`).click(); await page.keyboard.press('t');
        await move(page, 'h2e2').click(); await move(page, 'h9g7').click();
        pinnedPgn(await copyPgn(page));

        // Undo must preserve a main line explicitly chosen after the deletion.
        await importPgn(page, width, fixture);
        await move(page, 'h2e2').click(); await move(page, 'h9g7').click();
        await command(page, 'Set this as study main line');
        await move(page, 'h2e2').click();
        await command(page, 'Delete this move and what follows');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        for (const [file, rank] of [[7, 0], [6, 2]]) await page.locator(`.xiangqi-board .hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        await page.keyboard.press('t');
        await page.getByTestId('move-comment-input').fill('New main line');
        await page.getByTestId('move-comment-input').blur();
        await command(page, 'Set this as study main line');
        await page.getByTestId('delete-undo-btn').click();
        const restored = await copyPgn(page);
        pinnedPgn(restored, 'h0g2', 'h2e2');
        assert.ok(restored.includes('New main line'));
        await command(page, 'Save game');
        const restoredGame = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(count(restoredGame.moveTree), 6);
        assert.equal(restoredGame.moveTree[0].uci, 'h0g2');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: main-line controls, keyboard commands, identity/annotations, library/download, recovery, share, PGN/collection round-trips, re-promotion, clearing and undo after a newer choice passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
