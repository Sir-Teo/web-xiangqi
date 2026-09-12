const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 320]) for (const black of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async text => { window.__copied = text; } } }));
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.__wire = 'cp 150 lowerbound'; window.__searchDepth = 10;
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(fn => fn(line)); let position = '';
            return { variant: 'single-simd', addMessageListener: fn => listeners.push(fn), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('position ')) position = command;
              if (command.startsWith('go ')) queueMicrotask(() => {
                const move = position.endsWith('h2e2') ? 'h9g7' : 'h0g2';
                emit('info depth ' + (++window.__searchDepth) + ' multipv 1 score ' + window.__wire + ' pv ' + move);
                emit('bestmove ' + move);
              });
              if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };`
        }));
        // An imported quality mark makes this a persistent evaluation record,
        // while leaving its starting numeric evaluation unknown.
        const tree = [{ uci: 'h2e2', comment: 'Keep the study note', ...(black ? { quality: 'good' } : { children: [{ uci: 'h9g7', quality: 'good' }] }) }];
        await page.goto(base + '?moves=' + (black ? 'h2e2' : 'h2e2+h9g7') + '&tree=' + Buffer.from(JSON.stringify(tree)).toString('base64url'));
        await page.locator('.xiangqi-board').waitFor();
        await page.keyboard.press('e');
        const before = await page.locator('.hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
        const save = async () => {
          const count = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length);
          await command(page, 'Save game');
          await page.waitForFunction(count => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length > count, count);
          return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        };
        for (const [wire, expected, kind, pgnScore] of [
          ['cp 150 lowerbound', undefined, undefined, undefined],
          ['cp 20000', 20000, 'cp', '200.00'],
          ['mate 10000 upperbound', 20000, 'cp', '200.00'],
          ['cp 900 lowerbound', 20000, 'cp', '200.00'],
          ['mate 3', 29997, undefined, '#3'],
          ['cp 29997 upperbound', 29997, undefined, '#3'],
          ['cp 29997', 29997, 'cp', '299.97'],
        ]) {
          await page.evaluate(wire => { window.__wire = wire; }, wire);
          await page.getByTestId('deep-dive-btn').click();
          await page.waitForFunction(() => document.querySelector('[data-testid="engine-pv-line-0"] .turnNum')?.textContent?.trim() === 'Depth ' + window.__searchDepth);
          const bounded = /bound/.test(wire);
          assert.equal(await page.getByTestId('engine-pv-line-0').locator('.pv-line-standing').textContent(), bounded ? 'Not exact' : 'Best');
          const normalized = expected === undefined ? undefined : black ? -expected : expected;
          const checkSaved = game => {
            const record = black ? game.moveTree[0] : game.moveTree[0].children[0];
            assert.equal(record.evalScore, normalized, 'A bound must not overwrite or create an ordinary historical evaluation');
            assert.equal(record.evalScoreKind, kind, 'Bound fallback must preserve the exact score kind');
            assert.equal(game.finalEval, normalized, 'The library summary must not present a bound as an exact evaluation');
            assert.equal(game.finalEvalKind, kind);
            assert.equal(game.moveTree[0].comment, 'Keep the study note');
          };
          checkSaved(await save());
          await command(page, 'Copy PGN');
          const pgn = await page.evaluate(() => window.__copied);
          const scores = [...pgn.matchAll(/\[%eval ([^\]]+)\]/g)].map(match => match[1]);
          const expectedPgn = pgnScore?.startsWith('#') ? '#' + (black ? '-' : '') + pgnScore.slice(1) : (black ? '-' : '') + pgnScore;
          assert.deepEqual(scores, pgnScore ? [expectedPgn] : [], 'PGN must contain only the retained exact evaluation');
          await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
          checkSaved(await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')).game));
        }
        assert.deepEqual(await page.locator('.hitbox').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), before);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px/${black ? 'Black' : 'Red'}: bound-only history, saved summaries, retained exact cp/mate, PGN and autosave passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
