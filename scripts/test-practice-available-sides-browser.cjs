const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const cases = [
  { color: 'w', other: 'b', move: 'h2e2', squares: [[7, 2], [4, 2]] },
  { color: 'b', other: 'w', move: 'h9g7', squares: [[7, 9], [6, 7]],
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
        assert.match(await page.getByTestId('study-practice-recall').innerText(), /1 of 1/);
        console.log(`${browserType.name()} ${width}px/${sample.color}: unavailable practice side is disabled; legacy selection preserves completed progress`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
