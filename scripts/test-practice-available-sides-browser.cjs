const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const cases = [
  { color: 'w', other: 'b', move: 'h2e2', squares: [[7, 2], [4, 2]],
    reply: 'h9g7', replySquares: [[7, 9], [6, 7]], alternative: 'b2e2' },
  { color: 'b', other: 'w', move: 'h9g7', squares: [[7, 9], [6, 7]],
    reply: 'h2e2', replySquares: [[7, 2], [4, 2]], alternative: 'b9c7',
    startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1' },
];

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) for (const sample of cases) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      page.setDefaultTimeout(10000);
      try {
        await page.addInitScript(sample => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'one-side', savedAt: 1, gameMode: 'PvP', moves: [sample.move], startFen: sample.startFen },
          { id: 'mixed', savedAt: 2, gameMode: 'PvP', moves: [sample.move], startFen: sample.startFen,
            moveTree: [{ uci: sample.move }, { uci: sample.move, children: [{ uci: sample.reply }] },
              { uci: sample.alternative, children: [{ uci: sample.reply }] }] },
        ])), sample);
        await page.goto(base + '?moves=b2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Library');
        await page.keyboard.press('Enter');
        const open = page.getByTestId('practice-saved-one-side');
        await open.click();
        const dialog = page.getByTestId('study-practice-dialog');
        const side = dialog.getByRole('combobox', { name: 'Practice as', exact: true });
        await side.waitFor();
        assert.equal(await side.locator(`option[value="${sample.other}"]`).evaluate(option => option.disabled), true,
          'A side without saved moves must not be offered as a usable practice choice');
        for (const [file, rank] of sample.squares) await dialog.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        await page.waitForFunction(color => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1') || '[]')[0]?.sessions[color]?.completed.length === 1, sample.color);
        await dialog.getByRole('button', { name: 'Close study practice', exact: true }).click();
        await page.evaluate(({ color, other }) => {
          const entries = JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'));
          entries[0].side = other;
          entries[0].sessions[other] = entries[0].sessions[color];
          localStorage.setItem('xiangqi:practice-progress:v1', JSON.stringify(entries));
        }, sample);
        await open.click();
        await side.waitFor();
        assert.equal(await side.inputValue(), sample.color, 'Resume must choose a side with playable study moves');
        assert.match(await page.getByTestId('study-practice-progress').innerText(), /1 of 1/);
        assert.match(await page.getByTestId('study-practice-recall').innerText(), /1 of 1 move recalled without help/);
        await dialog.getByRole('button', { name: 'Close study practice', exact: true }).click();
        const beforeMixed = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const openMixed = page.getByTestId('practice-saved-mixed');
        await openMixed.click();
        await side.waitFor();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1') || '[]').some(entry => entry.id === 'mixed'));
        await dialog.getByRole('button', { name: 'Close study practice', exact: true }).click();
        await page.evaluate(({ color, other, move }) => {
          const entries = JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'));
          const entry = entries.find(entry => entry.id === 'mixed');
          entry.side = other;
          entry.sessions[color] = { line: 0, moves: [move], completed: [0], answered: 3, recalled: 2, assisted: false };
          entry.sessions[other] = { line: 0, moves: [move], completed: [0, 1], answered: 7, recalled: 5, assisted: true };
          localStorage.setItem('xiangqi:practice-progress:v1', JSON.stringify(entries));
        }, sample);
        await openMixed.click();
        await side.waitFor();
        assert.equal(await side.inputValue(), sample.other, 'A usable saved side must keep its own progress');
        assert.match(await dialog.getByTestId('study-practice-line-position').innerText(), /Line 2 of 2 · 0 of 2 moves played/);
        assert.match(await page.getByTestId('study-practice-progress').innerText(), /1 of 2/);
        assert.match(await page.getByTestId('study-practice-recall').innerText(), /5 of 7/);
        await page.waitForFunction(other => {
          const session = JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1') || '[]').find(entry => entry.id === 'mixed')?.sessions[other];
          return session?.line === 2 && session.moves.length === 0;
        }, sample.other);
        await dialog.getByRole('button', { name: 'Play saved reply', exact: true }).click();
        for (const [file, rank] of sample.replySquares) await dialog.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        assert.match(await page.getByTestId('study-practice-progress').innerText(), /2 of 2/);
        assert.match(await page.getByTestId('study-practice-recall').innerText(), /6 of 8/);
        assert.match(await dialog.getByTestId('study-practice-line-position').innerText(), /Line 2 of 2 · 2 of 2 moves played/);
        await side.selectOption(sample.color);
        assert.match(await dialog.getByTestId('study-practice-line-position').innerText(), /Line 1 of 3 · 1 of 1 move played/);
        assert.match(await page.getByTestId('study-practice-progress').innerText(), /1 of 3/);
        assert.match(await page.getByTestId('study-practice-recall').innerText(), /2 of 3/);
        await side.selectOption(sample.other);
        assert.match(await page.getByTestId('study-practice-progress').innerText(), /2 of 2/);
        assert.match(await page.getByTestId('study-practice-recall').innerText(), /6 of 8/);
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), beforeMixed);
        console.log(`${browserType.name()} ${width}px/${sample.color}: unavailable side stays disabled; mixed-study resume skips opponent-only lines while retaining both sides' progress and the saved study`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
