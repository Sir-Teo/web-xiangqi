const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
const source = '[White "Study"] h2e2 $2 {[%eval 200.00,18] Main note} h9g7?! {[%eval #10000,20]} (b9c7?? {[%eval -300.00,21] Branch note}) *\nh2e2 {[%eval -.75,19]} *';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
function checkTree(tree) {
  assert.equal(tree[0].evalScore, 20000); assert.equal(tree[0].evalScoreKind, 'cp'); assert.equal(tree[0].evalDepth, 18);
  assert.equal(tree[0].quality, 'mistake'); assert.equal(tree[0].comment, 'Main note');
  const main = tree[0].children.find(node => node.uci === 'h9g7');
  const branch = tree[0].children.find(node => node.uci === 'b9c7');
  assert.equal(main.evalScore, 20000); assert.equal(main.evalScoreKind, undefined); assert.equal(main.evalDepth, 20);
  assert.equal(branch.evalScore, -30000); assert.equal(branch.evalScoreKind, 'cp'); assert.equal(branch.evalDepth, 21);
  assert.equal(branch.quality, 'blunder'); assert.equal(branch.comment, 'Branch note');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        // Prevent new analysis from replacing the file's scores during this workflow.
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
        await page.goto(base + '?moves=h2e2');
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const panel = page.getByTestId('pgn-collection-import');
        await panel.locator('summary').click();
        await panel.getByLabel('Choose PGN collection').setInputFiles({ name: 'Annotated studies.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(source) });
        await panel.getByRole('button', { name: 'Import 2 games', exact: true }).click();
        await panel.getByRole('status').filter({ hasText: 'Imported 2 games.' }).waitFor();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')));
        checkTree(saved[0].moveTree);
        assert.equal(saved[0].review, undefined); assert.equal(saved[1].finalEval, -75);
        const download = page.waitForEvent('download');
        await page.getByTestId(`download-pgn-saved-${saved[0].id}`).click();
        const chunks = [];
        for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
        const pgn = Buffer.concat(chunks).toString();
        for (const command of ['[%eval 200.00,18]', '[%eval #10000,20]', '[%eval -300.00,21]', '$2', '$6', '$4']) assert.ok(pgn.includes(command), `Export lost ${command}`);
        await page.getByTestId(`load-saved-${saved[0].id}`).click();
        const graph = async (move, label) => {
          await page.keyboard.press('t');
          await page.locator('.mtree-chip').filter({ hasText: move }).click();
          const tabId = width < 900 ? 'mobile-analysis-tab-graph' : 'left-panel-tab-graph';
          await page.getByTestId(tabId).click();
          await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-selected') === 'true', tabId);
          await page.waitForFunction(label => document.querySelector('.graph-legend strong')?.textContent === 'Red POV ' + label, label);
          await page.getByTestId('graph-load-sweep').waitFor({ state: 'hidden' });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.evaluate(async () => {
            await Promise.all((document.querySelector('.mobile-analysis-tabs')?.getAnimations({ subtree: true }) ?? []).map(animation => animation.finished.catch(() => {})));
          });
        };
        await graph('h2e2', '+200.00'); await graph('h9g7', '+M10000'); await graph('b9c7', '-300.00');
        await page.getByTestId(width < 900 ? 'mobile-analysis-tab-review' : 'analysis-tab-review').click();
        await page.getByTestId('start-review-btn').waitFor({ state: 'visible' });
        assert.equal(await page.getByTestId('review-engine-summary').count(), 0, 'Imported annotations claimed a completed review');
        await command(page, 'Save game');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.[0]?.evalScoreKind === 'cp');
        await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await graph('h9g7', '+M10000'); await graph('b9c7', '-300.00');
        await command(page, 'Save game');
        checkTree(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1).moveTree));
        await graph('b9c7', '-300.00');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-collection-evals-${browserType.name()}-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()}: collection scores/depths/kinds, quality, notes, export, graph, separate review, save and recovery passed at ${width}px`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
