const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          let nodes = [];
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          for (let index = 1023; index >= 0; index--) nodes = [{ uci: cycle[index % 4], comment: 'Study plan ' + index, children: nodes }];
          localStorage.setItem('xiangqi:library:v1', JSON.stringify([
            { id: 'large-study', savedAt: 1, gameMode: 'PvP', label: 'Long study', moves: ['a0a1'], moveTree: nodes },
          ]));
          // Observe canonical move rows, not time or the number of React renders.
          const push = Array.prototype.push;
          window.__contentRows = 0;
          Array.prototype.push = function(...values) {
            for (const value of values) if (Array.isArray(value) && value.length === 6 && Number.isInteger(value[0])
              && typeof value[1] === 'string' && /^[a-i][0-9][a-i][0-9]$/.test(value[1])) window.__contentRows++;
            return Reflect.apply(push, this, values);
          };
        });
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        await page.getByTestId('load-saved-large-study').click();
        const status = page.getByTestId('study-save-status');
        const saved = () => page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const savedDetails = () => page.evaluate(() => {
          const game = JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0];
          return { metadata: game.metadata, firstNote: game.moveTree[0].comment };
        });
        const readRows = () => page.evaluate(() => window.__contentRows);
        const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="study-save-status"]')?.textContent.includes('Saved study'));
        await waitSaved();
        assert.ok(await readRows() >= 1024, 'The probe must observe the initial move comparison');
        const before = await saved();
        const editor = page.getByTestId('game-metadata');
        await editor.locator('summary').click();
        const player = editor.getByLabel('Red player', { exact: true });
        const event = editor.getByLabel('Event', { exact: true });
        await player.focus();
        await page.evaluate(() => { window.__contentRows = 0; });
        await player.pressSequentially('Alice Smith');
        assert.match(await status.innerText(), /Modified study/i);
        assert.equal(await readRows(), 0, 'Metadata typing must reuse the unchanged 1,024-move comparison');
        assert.equal(await saved(), before, 'Editing details must not update the library before Save');
        await player.fill('');
        await waitSaved();
        assert.equal(await readRows(), 0, 'Reverting metadata must also reuse the move comparison');

        // Enter fields in a different order from storage normalization.
        await event.fill('Open Cup');
        await player.fill('Alice');
        await status.click();
        await waitSaved();
        assert.deepEqual((await savedDetails()).metadata, { redPlayer: 'Alice', event: 'Open Cup' });
        await page.evaluate(() => { window.__contentRows = 0; });
        await player.fill(' Alice ');
        await waitSaved();
        assert.equal(await readRows(), 0, 'Whitespace-only edits retain the saved status without walking moves');
        await player.fill('Alice Smith');
        assert.match(await status.innerText(), /Modified study/i);
        await player.fill('Alice');
        await waitSaved();
        assert.equal(await readRows(), 0);

        const note = page.getByTestId('move-comment-input');
        await note.fill('Changed move plan');
        await note.blur();
        await page.waitForFunction(() => window.__contentRows > 0);
        assert.match(await status.innerText(), /Modified study/i, 'A real move edit must still invalidate the saved content');
        await status.click();
        await waitSaved();
        assert.equal((await savedDetails()).firstNote, 'Changed move plan');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: 1,024-move metadata edits reuse move content; revert, normalized save state and note invalidation passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
