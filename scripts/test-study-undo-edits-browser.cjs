const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
async function noteIs(page, value) {
  await page.waitForFunction(value => document.querySelector('[data-testid="move-comment-input"]')?.value === value, value, { timeout: 2000 });
}
async function play(page, from, to) {
  if (page.viewportSize().width < 900) await page.getByTestId('mobile-view-board').click();
  for (const square of [from, to]) {
    const file = square.charCodeAt(0) - 97, rank = Number(square[1]);
    await page.locator(`.xiangqi-board .hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
  }
  await page.keyboard.press('t');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
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
        await page.goto(base + '?moves=h2e2+h9g7+h0g2');
        await page.keyboard.press('t');
        await page.getByTestId('move-comment-input').fill('Deleted line note');
        await page.getByTestId('move-comment-input').blur();
        await command(page, 'Delete this move and what follows');
        await page.locator('.mtree-chip[data-node-id="n1"]').click();
        await page.getByTestId('move-comment-input').fill('New note after deletion');
        await page.getByTestId('move-comment-input').blur();
        await page.locator('.mtree-chip[data-node-id="n2"]').click();
        await page.getByTestId('delete-undo-btn').click();
        await page.locator('.mtree-chip[data-node-id="n1"]').click();
        await noteIs(page, 'New note after deletion');
        await page.locator('.mtree-chip[data-node-id="n3"]').click();
        await noteIs(page, 'Deleted line note');
        // A new alternative added after deleting the old line must survive Undo.
        await command(page, 'Delete this move and what follows');
        await play(page, 'b0', 'c2');
        await page.getByTestId('move-comment-input').fill('New alternative');
        await page.getByTestId('move-comment-input').blur();
        await page.getByTestId('delete-undo-btn').click();
        assert.equal(await page.locator('.mtree-chip').count(), 4);
        await page.locator('.mtree-chip[data-node-id="n4"]').click();
        await noteIs(page, 'New alternative');
        await page.locator('.mtree-chip[data-node-id="n3"]').click();
        await noteIs(page, 'Deleted line note');

        // Replaying the deleted move should reuse the new node and recover the
        // old annotation even though the cursor's ID does not change on Undo.
        await command(page, 'Delete this move and what follows');
        await play(page, 'h0', 'g2');
        await page.getByTestId('delete-undo-btn').click();
        assert.equal(await page.locator('.mtree-chip[data-node-id="n3"]').count(), 0);
        assert.equal(await page.getByTestId('move-tree-active').getAttribute('data-node-id'), 'n5');
        await noteIs(page, 'Deleted line note');
        await page.locator('.mtree-chip[data-node-id="n1"]').click();
        await noteIs(page, 'New note after deletion');
        await page.locator('.mtree-chip[data-node-id="n5"]').click();
        await noteIs(page, 'Deleted line note');

        // New notes and descendants on a replayed move take precedence.
        await command(page, 'Delete this move and what follows');
        await play(page, 'h0', 'g2');
        await page.getByTestId('move-comment-input').fill('New replay annotation');
        await page.getByTestId('move-comment-input').blur();
        await play(page, 'b9', 'c7');
        await page.getByTestId('move-comment-input').fill('New continuation');
        await page.getByTestId('move-comment-input').blur();
        await page.getByTestId('delete-undo-btn').click();
        assert.equal(await page.getByTestId('move-tree-active').getAttribute('data-node-id'), 'n6');
        await noteIs(page, 'New replay annotation');
        await page.locator('.mtree-chip[data-node-id="n7"]').click();
        await noteIs(page, 'New continuation');
        assert.equal(await page.locator('.mtree-chip').count(), 5);
        // Undoing an off-line deletion at the root keeps the selected continuation.
        await page.locator('.mtree-chip[data-node-id="n4"]').click();
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        await page.locator('button[aria-label="Go to first position"]:visible').first().click();
        if (width < 900) await page.keyboard.press('t');
        await page.getByTestId('delete-variation-n6').click();
        await page.getByTestId('delete-undo-btn').click();
        assert.deepEqual(await page.locator('.mtree-row .mtree-chip').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId)), ['n1', 'n2', 'n4']);
        await command(page, 'Save game');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        const nodes = [];
        const collect = list => { for (const node of list || []) { nodes.push(node); collect(node.children); } };
        collect(saved.moveTree);
        assert.equal(nodes.length, 5);
        assert.equal(nodes.filter(node => node.uci === 'h0g2').length, 1);
        for (const note of ['New note after deletion', 'New alternative', 'New replay annotation', 'New continuation']) {
          assert.ok(nodes.some(node => node.comment === note), `Saved study is missing ${note}`);
        }

        // Clearing a newer annotation on a replayed move is an edit too.
        // Undo restores the deleted continuation without resurrecting text or
        // symbols that the author has deliberately removed since deletion.
        await page.locator('.mtree-chip[data-node-id="n6"]').click();
        let glyphs = page.getByTestId('imported-glyphs');
        await glyphs.locator(':scope > summary').click();
        await glyphs.getByRole('combobox', { name: 'Add study annotation' }).selectOption('1');
        await glyphs.getByRole('button', { name: 'Apply symbol', exact: true }).click();
        await command(page, 'Delete this move and what follows');
        await play(page, 'h0', 'g2');
        await page.getByTestId('move-comment-input').fill('Temporary correction');
        await page.getByTestId('move-comment-input').blur();
        await page.getByTestId('move-comment-input').fill('');
        await page.getByTestId('move-comment-input').blur();
        glyphs = page.getByTestId('imported-glyphs');
        await glyphs.locator(':scope > summary').click();
        await glyphs.getByRole('combobox', { name: 'Add study annotation' }).selectOption('2');
        await glyphs.getByRole('button', { name: 'Apply symbol', exact: true }).click();
        await glyphs.getByRole('button', { name: /Remove .*\(\$2\)/ }).click();
        await page.getByTestId('delete-undo-btn').click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="delete-undo-btn"]'));
        assert.deepEqual({
          note: await page.getByTestId('move-comment-input').inputValue(),
          symbols: await glyphs.locator(':scope > ul > li').count(),
        }, { note: '', symbols: 0 }, 'Undo must respect deliberately cleared annotations');
        await page.locator('.mtree-chip[data-node-id="n7"]').click();
        await noteIs(page, 'New continuation');
        await command(page, 'Save game');
        const clearedStudy = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        const clearedNodes = [];
        const collectCleared = list => { for (const node of list || []) { clearedNodes.push(node); collectCleared(node.children); } };
        collectCleared(clearedStudy.moveTree);
        const replayed = clearedNodes.find(node => node.uci === 'h0g2');
        assert.ok(replayed);
        assert.equal(replayed.comment, undefined);
        assert.equal(replayed.nags, undefined);
        assert.equal(clearedNodes.length, 5);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: undo preserves later notes/moves and explicit annotation removal, merges replayed branches, restores annotations and saves the complete tree`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
