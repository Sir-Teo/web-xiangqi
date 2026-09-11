const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function followEngineLine(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.__pv = 'h2e2 h9g7 h0g2';
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = [];
        const emit = line => listeners.forEach(listener => listener(line));
        let position = '';
        return {
          variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {},
          postMessage(command) {
            if (command.startsWith('position ')) position = command;
            if (command === 'uci') queueMicrotask(() => emit('uciok'));
            if (command === 'isready') queueMicrotask(() => emit('readyok'));
            if (command.startsWith('go ') && position === 'position startpos') queueMicrotask(() => {
              emit('info depth 12 multipv 1 score cp 30 pv ' + window.__pv);
              emit('bestmove h2e2');
            });
            if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
          }
        };
      };
    ` }));
    await page.goto(base);
    await page.keyboard.press('e');
    const keep = page.getByTestId('keep-engine-pv-0');
    await keep.waitFor();
    const boardState = () => page.locator('.hitbox').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')));
    const initial = await boardState();
    if (width < 900) assert.ok((await keep.boundingBox()).height >= 44);
    await keep.click();
    assert.deepEqual(await boardState(), initial, 'Keeping a line moved the board');
    assert.equal(await keep.isDisabled(), true, 'The complete line was not recognized as kept');
    await page.keyboard.press('t');
    assert.equal(await page.locator('.mtree-chip').count(), 3);
    assert.equal(await page.locator('.mtree-chip-active').count(), 0);

    // Keep a different root variation through the command palette.
    await page.keyboard.press('e');
    await page.evaluate(() => { window.__pv = 'b2e2 b9c7 b0c2'; });
    await page.getByTestId('deep-dive-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="keep-engine-pv-0"]')?.disabled === false);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Keep best engine line');
    await page.keyboard.press('Enter');
    assert.equal(await keep.isDisabled(), true);
    assert.deepEqual(await boardState(), initial);

    // An illegal suffix must not leave its otherwise legal new first move.
    await page.evaluate(() => { window.__pv = 'a0a1 h9h8'; });
    await page.getByTestId('deep-dive-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="keep-engine-pv-0"]')?.disabled === false);
    await keep.click();
    assert.match(await page.getByTestId('notice-announcement').innerText(), /Nothing was added/);
    await page.keyboard.press('t');
    assert.equal(await page.locator('.mtree-chip').count(), 6);
    assert.deepEqual(await boardState(), initial);

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Save game');
    await page.keyboard.press('Enter');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0]);
    assert.deepEqual(saved.moves, [], 'Save moved the study cursor away from the root');
    const treeLine = node => [node.uci, ...(node.children?.length ? treeLine(node.children[0]) : [])];
    assert.deepEqual(saved.moveTree.map(treeLine), [['h2e2', 'h9g7', 'h0g2'], ['b2e2', 'b9c7', 'b0c2']]);

    const downloadReady = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Download PGN');
    await page.keyboard.press('Enter');
    const download = await downloadReady;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const pgn = Buffer.concat(chunks).toString();
    for (const move of ['h2e2', 'h9g7', 'h0g2', 'b2e2', 'b9c7', 'b0c2']) assert.ok(pgn.includes(move), `PGN lost ${move}`);

    await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.moveTree?.length === 2);
    await page.reload();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    assert.deepEqual(await boardState(), initial, 'Restoring kept lines moved the board');
    await page.keyboard.press('t');
    assert.equal(await page.locator('.mtree-chip').count(), 6, 'Restoring lost a kept variation');
    await page.keyboard.press('e');
    await page.getByTestId('engine-pv-0-move-2').waitFor();
    assert.equal(await keep.isDisabled(), true);
    await page.locator('[data-testid="engine-pv-line-0"]').screenshot({ path: `/tmp/xiangqi-keep-line-${width}.png` });
    await page.getByTestId('engine-pv-0-move-2').click();
    for (const [file, rank, piece] of [[4, 2, 'red cannon'], [6, 7, 'black horse'], [6, 2, 'red horse']]) {
      assert.match(await page.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).getAttribute('aria-label'), new RegExp(piece));
    }
    await page.keyboard.press('t');
    assert.equal(await page.locator('.mtree-chip').count(), 6);
    assert.equal(await page.locator('.mtree-chip-active').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    // A full study must remain recoverable after rejecting an oversized addition.
    await page.addInitScript(() => {
      const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
      let children = [];
      for (let i = 1023; i >= 0; i--) children = [{ uci: cycle[i % 4], children }];
      localStorage.setItem('xiangqi:auto-saved-game:v1', JSON.stringify({
        version: 1, savedAt: Date.now(),
        game: { id: 'full-study', savedAt: Date.now(), gameMode: 'PvP', moves: [], moveTree: children },
      }));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.keyboard.press('e');
    await keep.click();
    assert.match(await page.getByTestId('notice-announcement').innerText(), /Study limit reached/);
    assert.deepEqual(await boardState(), initial);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('Save game');
    await page.keyboard.press('Enter');
    const fullStudy = JSON.parse(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('xiangqi:library:v1'))
      .find(game => game.moveTree?.[0]?.uci === 'a0a1') ?? null)));
    assert.ok(fullStudy, 'The study could not be saved after rejecting the line');
    assert.equal(fullStudy.moveTree.length, 1, 'Rejected line added a root branch');
    assert.equal(treeLine(fullStudy.moveTree[0]).length, 1024);
    assert.deepEqual(errors, []);
    console.log(`Keep/replay engine lines, atomic rejection, branching, save, PGN, reload, study limit and layout passed at ${width}px`);
  } catch (error) {
    await page.screenshot({ path: `/tmp/xiangqi-keep-failure-${width}.png` });
    console.error(await page.locator('body').innerText());
    throw error;
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch();
  try { for (const width of [1440, 390]) await followEngineLine(browser, width); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
