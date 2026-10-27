const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, name) {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: 'Search commands' });
  await input.fill(name); await page.keyboard.press('Enter');
  await input.waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      page.setDefaultTimeout(10000);
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__score = 25;
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ')) queueMicrotask(() => {
                emit('info depth 18 multipv 1 score cp ' + window.__score + ' pv h2e2 h9g7 h0g2');
                emit('bestmove h2e2');
              });
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').first().waitFor();
        await page.keyboard.press('e');
        await page.getByRole('button', { name: /^Go deep: search this position,/ }).waitFor();
        const maintenance = page.getByTestId('advanced-engine-maintenance').locator('summary');
        await maintenance.click();
        await page.getByRole('button', { name: 'Clear hash: empty the engine search table', exact: true }).waitFor();
        await maintenance.click();
        await page.getByRole('button', { name: 'Keep line 1 in the move tree', exact: true }).click();
        const kept = page.getByRole('button', { name: 'Kept line 1 in the move tree', exact: true });
        await kept.waitFor(); assert.equal(await kept.isDisabled(), true);
        await page.evaluate(() => { window.__score = 50; });
        await page.getByTestId('deep-dive-btn').click();
        await page.getByRole('button', { name: 'Update analysis for engine line 1', exact: true }).click();
        await kept.waitFor(); assert.equal(await kept.isDisabled(), true);
        await command(page, 'Import a game record');
        await page.getByTestId('uci-line-input').fill('{Opening plan} h2e2 {Main cannon} (b2e2 {Side cannon} a9a8) h9g7 *');
        await page.getByTestId('import-uci-line-btn').click();
        await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
        await page.keyboard.press('t');
        for (const notation of ['WXF', 'Chinese', 'UCI']) {
          if (notation !== 'WXF') await command(page, notation === 'UCI' ? 'Write moves in coordinates (UCI)' : 'Write moves in Chinese (中文)');
          const moves = page.locator('.mtree-chip');
          await moves.first().waitFor();
          for (const move of await moves.all()) {
            const visible = (await move.innerText()).replace(/\s+/g, ' ').trim();
            assert.ok((await move.getAttribute('aria-label')).includes(visible), `Move name must retain ${visible}`);
          }
          if (width >= 900) {
            for (const crumb of await page.locator('.tree-breadcrumb-chip').all()) {
              const visible = await crumb.evaluate(node => [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim());
              assert.ok((await crumb.getAttribute('aria-label')).includes(visible), `Breadcrumb name must retain ${visible}`);
            }
          }
        }
        await command(page, 'Settings');
        await page.getByRole('button', { name: /^帥 將: Draw the pieces as traditional characters/ }).waitFor();
        await page.getByRole('button', { name: /^K A E: Draw the pieces as WXF letters/ }).waitFor();
        console.log(`${browserType.name()} ${width}px: engine action states, all move notations, breadcrumbs and piece styles retain their visible names`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
