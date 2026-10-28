const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const game = { id: 'picker', savedAt: 1, gameMode: 'PvP', label: 'Choose a practice line', moves: ['a3a4'],
  moveTree: [{ uci: 'a3a4', comment: 'Short line note' },
    { uci: 'h2e2', comment: 'Central cannon', children: [
      { uci: 'h9g7', comment: 'Right horse' }, { uci: 'b9c7', comment: 'Left horse' },
    ] }, { uci: 'b2e2', comment: 'Other cannon', children: [{ uci: 'h9g7' }] }] };
async function open(page, id) {
  await page.locator('.xiangqi-board').waitFor();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Library');
  await page.keyboard.press('Enter');
  await page.getByTestId(`practice-saved-${id}`).click();
  await page.getByTestId('study-practice-progress').waitFor();
}
const picker = page => page.locator('.study-practice-line-picker');
const field = page => picker(page).getByRole('spinbutton', { name: 'Line number', exact: true });
async function choose(page, ordinal) {
  const panel = picker(page);
  if (await panel.getAttribute('open') === null) await panel.locator('summary').click();
  await field(page).fill(String(ordinal));
  await field(page).press('Enter');
}
async function move(dialog, uci) {
  for (const square of [uci.slice(0, 2), uci.slice(2)]) {
    await dialog.locator(`.hitbox[data-file="${square.charCodeAt(0) - 97}"][data-rank="${square[1]}"]`).click();
  }
}
const stored = page => page.evaluate(() => localStorage.getItem('xiangqi:practice-progress:v1'));

// Generate an actual legal 8,192-node tree with thousands of distinct leaves.
// The rule module has no runtime imports; use the same transpiler as library QA.
function broadStudy() {
  const filename = path.join(__dirname, '../src/utils/xiangqi.ts');
  const compiled = new Module(filename);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  const { START_FEN, parseFenBoard, pieceSide, legalMovesFrom, squareToUci } = compiled.exports;
  let count = 0;
  const append = (board, side, depth) => {
    const nodes = [];
    for (let rank = 0; rank < 10 && count < 8192; rank++) for (let file = 0; file < 9 && count < 8192; file++) {
      if (pieceSide(board[rank][file]) !== side) continue;
      for (const target of legalMovesFrom(board, file, rank, side)) {
        if (count === 8192) break;
        const node = { uci: squareToUci(file, rank) + squareToUci(target.file, target.rank) };
        nodes.push(node); count++;
        if (depth < 3 && count < 8192) {
          const next = board.map(row => [...row]);
          next[target.rank][target.file] = next[rank][file]; next[rank][file] = '';
          const children = append(next, side === 'w' ? 'b' : 'w', depth + 1);
          if (children.length) node.children = children;
        }
      }
    }
    return nodes;
  };
  const moveTree = append(parseFenBoard(START_FEN), 'w', 1);
  const leaves = nodes => nodes.reduce((sum, node) => sum + (node.children ? leaves(node.children) : 1), 0);
  assert.equal(count, 8192);
  const total = leaves(moveTree);
  assert.ok(total > 7000);
  return { record: { id: 'broad', savedAt: 1, gameMode: 'PvP', moves: [], moveTree }, total };
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: width < 900 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(game => localStorage.setItem('xiangqi:library:v1', JSON.stringify([game])), game);
        await page.goto(base); await open(page, game.id);
        const dialog = page.getByTestId('study-practice-dialog');
        const line = dialog.getByTestId('study-practice-line-position');
        const progress = dialog.getByTestId('study-practice-progress');
        const recall = dialog.getByTestId('study-practice-recall');
        const notes = dialog.getByTestId('study-practice-line-notes');
        const close = dialog.getByRole('button', { name: 'Close study practice', exact: true });
        const original = await page.evaluate(() => ({ library: localStorage.getItem('xiangqi:library:v1'),
          board: [...document.querySelectorAll('.board-stage .hitbox')].map(node => node.getAttribute('aria-label')) }));
        await move(dialog, 'a3a4');
        assert.match(await progress.innerText(), /1 of 4/);
        await notes.locator('summary').click(); await notes.locator('li').first().waitFor();
        assert.deepEqual(await notes.locator('li p').allTextContents(), ['Short line note']);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1') || '[]')[0]?.sessions.w?.completed.length === 1);
        const before = await stored(page);
        await picker(page).locator('summary').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
        assert.equal(await field(page).evaluate(node => node === document.activeElement), true);
        for (const invalid of ['', '0', '5', '1.5']) {
          await field(page).fill(invalid); await field(page).press('Enter');
          assert.equal(await field(page).evaluate(node => node.validity.valid), false);
          assert.match(await line.innerText(), /Line 1 of 4 · 1 of 1 move played/);
          assert.equal(await stored(page), before, 'Invalid or unfinished choices must not change saved progress');
          assert.equal(await notes.getAttribute('open'), '');
        }
        await choose(page, 4);
        assert.match(await line.innerText(), /Line 4 of 4 · 0 of 2 moves played/);
        assert.match(await recall.innerText(), /1 of 1/);
        assert.equal(await notes.count(), 0, 'Switching lines must hide the old line notes');
        assert.equal(await dialog.locator('.hitbox[tabindex="0"]').evaluate(node => node === document.activeElement), true);
        await dialog.getByRole('button', { name: 'Show a saved move', exact: true }).click();
        await choose(page, 2);
        assert.equal(await dialog.getByTestId('study-practice-hint').count(), 0);
        await move(dialog, 'h2e2'); await dialog.getByRole('button', { name: 'Play saved reply', exact: true }).click();
        assert.match(await progress.innerText(), /2 of 4/); assert.match(await recall.innerText(), /2 of 2/);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0].sessions.w.moves.length === 2);
        await close.click(); await page.getByTestId('practice-saved-picker').click(); await progress.waitFor();
        assert.match(await line.innerText(), /Line 2 of 4 · 2 of 2 moves played/);
        const side = dialog.getByRole('combobox', { name: 'Practice as', exact: true });
        await side.selectOption('b'); await picker(page).locator('summary').click();
        assert.equal(await field(page).getAttribute('max'), '3', 'Line numbers must exclude lines without a move for the chosen side');
        await choose(page, 2);
        assert.match(await line.innerText(), /Line 2 of 3 · 0 of 2 moves played/);
        const reply = dialog.getByRole('button', { name: 'Play saved reply', exact: true });
        assert.equal(await reply.evaluate(node => node === document.activeElement), true);
        await reply.click(); await move(dialog, 'b9c7');
        assert.match(await progress.innerText(), /1 of 3/); assert.match(await recall.innerText(), /1 of 1/);
        await side.selectOption('w');
        assert.match(await progress.innerText(), /2 of 4/); assert.match(await recall.innerText(), /2 of 2/);
        await dialog.getByRole('button', { name: 'Reset progress for this side', exact: true }).click();
        await picker(page).locator('summary').click(); await field(page).fill('0'); await field(page).press('Enter');
        const undo = dialog.getByRole('button', { name: 'Undo reset', exact: true });
        assert.equal(await undo.count(), 1, 'A rejected choice must preserve reset recovery');
        await undo.click(); assert.match(await progress.innerText(), /2 of 4/);
        for (const font of [16, 32]) {
          await page.evaluate(font => document.documentElement.style.fontSize = font + 'px', font);
          if (await picker(page).getAttribute('open') === null) await picker(page).locator('summary').click();
          await field(page).fill('4');
          for (const control of await picker(page).locator('summary, input, button').all()) {
            await control.scrollIntoViewIfNeeded();
            assert.equal(await control.evaluate(node => {
              const box = node.getBoundingClientRect();
              return box.height >= 43.99 && box.x >= 0 && box.right <= innerWidth + 1
                && node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
                && node.scrollWidth <= node.clientWidth + 1;
            }), true, 'Chooser controls must fit and remain reachable at enlarged text sizes');
          }
          // Inspect the whole chooser at phone width after verifying every
          // control in the actual short viewport above.
          if (width === 320 && font === 32) await page.setViewportSize({ width, height: 1600 });
          await picker(page).screenshot({ path: `/tmp/xiangqi-practice-picker-${browserType.name()}-${width}-${font}.png` });
          if (width === 320 && font === 32) await page.setViewportSize({ width, height });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        }
        const after = await page.evaluate(() => ({ library: localStorage.getItem('xiangqi:library:v1'),
          board: [...document.querySelectorAll('.board-stage .hitbox')].map(node => node.getAttribute('aria-label')) }));
        assert.deepEqual(after, original); assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: direct line choice, input validation, notes/hints, scores, resume, independent sides, focus and 100/200% layout passed`);
      } finally { await page.close(); }
    }
    const broad = broadStudy();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    try {
      await page.addInitScript(record => localStorage.setItem('xiangqi:library:v1', JSON.stringify([record])), broad.record);
      await page.goto(base); await open(page, 'broad');
      await picker(page).locator('summary').click();
      assert.equal(await field(page).getAttribute('max'), String(broad.total));
      assert.ok(await picker(page).locator('*').count() < 12, 'Large studies must not create a control for every line');
      await page.waitForFunction(() => Boolean(localStorage.getItem('xiangqi:practice-progress:v1')));
      const before = await stored(page);
      await page.evaluate(() => {
        window.__pickerBoardChanges = 0;
        new MutationObserver(records => { window.__pickerBoardChanges += records.length; })
          .observe(document.querySelector('.study-practice-board'), { attributes: true, childList: true, subtree: true });
      });
      await field(page).fill(String(broad.total)); await field(page).press('ArrowDown'); await field(page).press('ArrowUp');
      assert.equal(await stored(page), before);
      assert.equal(await page.evaluate(() => window.__pickerBoardChanges), 0, 'Typing a target must leave the current board unchanged');
      await field(page).press('Enter');
      assert.match(await page.getByTestId('study-practice-line-position').innerText(), new RegExp(`Line ${broad.total} of ${broad.total} · 0 of`));
      await page.evaluate(() => document.documentElement.style.fontSize = '32px');
      await picker(page).locator('summary').click();
      assert.equal(await field(page).inputValue(), String(broad.total));
      assert.equal(await field(page).evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'Large line numbers must fit enlarged input text');
      console.log(`${browserType.name()}: direct access to ${broad.total} lines in an 8,192-move study uses constant chooser markup and keeps unfinished input local`);
    } finally { await page.close(); }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
