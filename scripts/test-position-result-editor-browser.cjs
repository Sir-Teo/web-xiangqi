const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function editor(page) {
  await command(page, 'Move tree');
  const details = page.getByTestId('game-metadata');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  const select = details.getByRole('combobox', { name: /Result at this position/ });
  await select.scrollIntoViewIfNeeded();
  return select;
}
async function copyPgn(page, tag) {
  await command(page, 'Copy PGN');
  const text = await page.evaluate(() => window.__copied);
  assert.ok(text.includes(`[Result "${tag}"]`), text);
  assert.ok(text.trimEnd().endsWith(tag), text);
  return text;
}
const move = (page, uci) => page.locator('.mtree-chip').filter({ has: page.locator('.move-uci', { hasText: uci }) });
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const common = { savedAt: 1, gameMode: 'PvP' };
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { ...common, id: 'legacy', label: 'Legacy resignation', moves: ['h2e2'], result: 'red' },
            { ...common, id: 'root', label: 'Starting diagram', moves: [], metadata: { event: 'Diagram' }, result: 'ongoing' },
            { ...common, id: 'branch', label: 'Branched study', moves: ['b2e2', 'h9g7'], result: 'ongoing',
              moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }, { uci: 'b2e2', children: [{ uci: 'h9g7' }] }] },
            { ...common, id: 'terminal', label: 'Stalemate diagram', moves: [], result: 'draw',
              startFen: '3k5/4R4/9/9/9/9/9/9/9/4K4 b - - 0 1' },
          ]));
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
        });
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
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        await page.getByTestId('load-saved-legacy').click();
        await page.getByRole('dialog', { name: 'Red Wins', exact: true }).getByRole('button', { name: 'Review', exact: true }).click();
        const status = page.getByTestId('study-save-status');
        const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="study-save-status"]')?.textContent.includes('Saved study')).catch(async error => {
          console.error('Study save state:', await status.textContent(), await page.getByTestId('save-game-error').allTextContents());
          throw error;
        });
        const save = async id => {
          await page.keyboard.press('ControlOrMeta+s');
          await waitSaved();
          return page.evaluate(id => {
            const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
            if (games.length !== 4) throw Error('Updating a result must preserve the saved study identity');
            return games.find(game => game.id === id);
          }, id);
        };
        let select = await editor(page);
        assert.equal(await select.inputValue(), 'red-wins');
        const original = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        await select.selectOption('black-wins');
        assert.match(await status.textContent(), /Modified study/);
        await select.selectOption('red-wins');
        await waitSaved();
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), original);
        await select.selectOption('black-wins');
        for (const size of [16, 32]) {
          await page.evaluate(size => document.documentElement.style.fontSize = size + 'px', size);
          await select.evaluate(node => node.scrollIntoView({ block: 'center' }));
          const fit = await select.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { height: rect.height, textSize: parseFloat(getComputedStyle(node).fontSize), reachable: node === hit,
              fits: rect.x >= 0 && rect.right <= innerWidth + 1 };
          });
          assert.ok(fit.height >= 43.99 && fit.textSize >= size && fit.reachable && fit.fits, JSON.stringify(fit));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.screenshot({ path: `/tmp/xiangqi-position-result-${browserType.name()}-${width}-${size}.png` });
        }
        await page.evaluate(() => document.documentElement.style.fontSize = '16px');
        await copyPgn(page, '0-1');
        let saved = await save('legacy');
        assert.equal(saved.result, 'black');
        assert.equal(saved.moveTree[0].recordedResult, 'black-wins');
        select = await editor(page); await select.selectOption('');
        await copyPgn(page, '*');
        saved = await save('legacy');
        assert.equal(saved.result, 'ongoing');
        assert.equal(saved.moveTree?.[0]?.recordedResult, undefined);
        await command(page, 'Library'); await page.getByTestId('load-saved-legacy').click();
        select = await editor(page); assert.equal(await select.inputValue(), '');
        assert.equal(await page.locator('.game-over-modal').count(), 0);
        await command(page, 'Library'); await page.getByTestId('load-saved-root').click();
        select = await editor(page);
        await page.getByTestId('game-metadata').getByLabel('Event', { exact: true }).fill('');
        assert.equal(await status.isDisabled(), true, 'An empty diagram has nothing to save yet');
        await select.selectOption('draw');
        assert.equal(await status.isEnabled(), true, 'A root result alone must make the study saveable');
        await copyPgn(page, '1/2-1/2');
        saved = await save('root');
        assert.equal(saved.rootResult, 'draw'); assert.equal(saved.result, 'draw');
        assert.deepEqual(saved.moves, []); assert.equal(saved.rootComment, undefined);
        assert.equal(saved.metadata, undefined);
        await command(page, 'Copy link');
        const rootUrl = await page.evaluate(() => window.__copied);
        const recipient = await browser.newPage({ viewport: { width, height } });
        try {
          await recipient.goto(rootUrl);
          await recipient.locator('.xiangqi-board').waitFor();
          const rootSelect = await editor(recipient);
          assert.equal(await rootSelect.inputValue(), 'draw');
        } finally { await recipient.close(); }
        await command(page, 'Library'); await page.getByTestId('load-saved-branch').click();
        select = await editor(page); await select.selectOption('draw');
        saved = await save('branch');
        assert.equal(saved.moveTree[0].children[0].recordedResult, undefined);
        assert.equal(saved.moveTree[1].children[0].recordedResult, 'draw');
        // Replaying and clearing a declaration after deletion is newer intent
        // than the result stored in Undo's copy of the removed move.
        await command(page, 'Delete this move and what follows');
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        for (const [file, rank] of [[7, 9], [6, 7]]) await page.locator(`.xiangqi-board .hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        select = await editor(page);
        await select.selectOption('draw'); await select.selectOption('');
        await page.getByTestId('delete-undo-btn').click();
        select = await editor(page); assert.equal(await select.inputValue(), '', 'Undo must keep an explicitly cleared result');
        await copyPgn(page, '*');
        saved = await save('branch');
        assert.equal(saved.moveTree[1].children[0].recordedResult, undefined);
        assert.equal(saved.result, 'ongoing');
        select = await editor(page); await select.selectOption('draw');
        await save('branch');
        await move(page, 'h2e2').click(); await command(page, 'Go to latest move');
        select = await editor(page); assert.equal(await select.inputValue(), '');
        await copyPgn(page, '*');
        await move(page, 'b2e2').click(); await command(page, 'Go to latest move');
        select = await editor(page); assert.equal(await select.inputValue(), 'draw');
        await copyPgn(page, '1/2-1/2');
        await command(page, 'Library'); await page.getByTestId('load-saved-terminal').click();
        await page.getByRole('dialog', { name: 'Red Wins', exact: true }).getByRole('button', { name: 'Review', exact: true }).click();
        select = await editor(page);
        assert.equal(await select.isDisabled(), true);
        assert.equal(await select.inputValue(), 'red-wins');
        assert.match(await page.getByTestId('position-result-editor').innerText(), /Checkmate or stalemate/);
        await copyPgn(page, '1-0');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: editable/clearable root and branch results, legacy correction, edit/revert, same-ID saves, PGN/share, automatic wins and 100/200% control reachability passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
