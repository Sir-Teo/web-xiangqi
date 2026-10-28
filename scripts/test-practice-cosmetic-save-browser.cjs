const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 480 : 844 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'progress', savedAt: 1, gameMode: 'PvP', label: 'Warmup study', moves: ['h2e2', 'h9g7'] },
          ]));
          // This is the old library fingerprint of the fixture, from before
          // practice revisions followed only their teaching content.
          localStorage.setItem('xiangqi:practice-progress:v1', JSON.stringify([{
            id: 'progress', revision: 'e8980357:ded6ca03:89', side: 'w', updatedAt: 1, sessions: {
              w: { line: 0, moves: ['h2e2'], completed: [], answered: 1, recalled: 1, assisted: false },
              b: { line: 0, moves: [], completed: [], answered: 3, recalled: 2, assisted: false },
            },
          }]));
        });
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        await page.getByTestId('load-saved-progress').click();
        await command(page, 'Move tree');
        const metadata = page.getByTestId('game-metadata');
        if (await metadata.getAttribute('open') === null) await metadata.locator('summary').click();
        await metadata.getByLabel('Event', { exact: true }).fill('Club match');
        const rawLibrary = () => page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const rawProgress = () => page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0]);
        const legacy = await rawProgress();
        const save = async () => {
          const before = await rawLibrary();
          await page.keyboard.press('ControlOrMeta+s');
          await page.waitForFunction(before => localStorage.getItem('xiangqi:library:v1') !== before, before);
          await page.waitForFunction(() => document.querySelector('[data-testid="study-save-status"]')?.textContent.includes('Saved study'));
          return page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0]);
        };
        await save();
        const migrated = await rawProgress();
        assert.match(migrated.revision, /^p2:/, 'Saving details before opening practice must migrate old progress');
        assert.deepEqual(migrated.sessions, legacy.sessions);
        assert.equal(migrated.updatedAt, legacy.updatedAt, 'A metadata save must not count as a practice action');
        const dialog = page.getByTestId('study-practice-dialog');
        const close = () => dialog.getByRole('button', { name: 'Close study practice', exact: true }).click();
        const open = async (resumed = true) => {
          await command(page, 'Library');
          const before = await rawLibrary();
          await page.getByTestId('practice-saved-progress').click();
          await dialog.getByTestId('study-practice-progress').waitFor();
          const center = await dialog.locator('.hitbox[data-file="4"][data-rank="2"]').getAttribute('aria-label');
          assert.match(center, resumed ? /red cannon/i : /empty/i, 'Practice must restore its learned prefix, or start fresh after a training edit');
          if (resumed) {
            assert.match(await dialog.getByTestId('study-practice-recall').innerText(), /1 of 1/);
            assert.equal(await dialog.getByRole('button', { name: 'Play saved reply', exact: true }).isVisible(), true);
          } else assert.equal(await dialog.getByTestId('study-practice-recall').count(), 0);
          assert.equal(await rawLibrary(), before, 'Opening practice must leave the saved study unchanged');
        };
        await open(); await close();
        // Updating the stored cursor changes the saved path to a root plus a
        // complete tree, while the practiced line remains exactly the same.
        await command(page, 'Go to start');
        const browsed = await save();
        assert.deepEqual(browsed.moves, []);
        assert.equal(browsed.moveTree[0].children[0].uci, 'h9g7');
        await open(); await close();
        await command(page, 'Move tree');
        if (await metadata.getAttribute('open') === null) await metadata.locator('summary').click();
        await metadata.getByRole('combobox', { name: /Result at this position/ }).selectOption('draw');
        await save();
        await open(); await close();
        // A change to the notes being taught must still invalidate both sides.
        await command(page, 'Write a note on this move');
        await page.getByTestId('move-comment-input').fill('Updated training plan');
        await save();
        await open(false);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:practice-progress:v1'))[0].sessions.w.moves.length === 0);
        assert.equal((await rawProgress()).sessions.b, undefined);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: old two-side progress survives metadata save, cursor/tree conversion and recorded results; real note edits start fresh; practice leaves the library unchanged`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
