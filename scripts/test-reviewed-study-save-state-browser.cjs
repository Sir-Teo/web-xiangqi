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
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          const games = [{ id: 'compact', moves: ['h2e2'] }, { id: 'tree', moves: ['b2e2', 'h9g7'],
            moveTree: [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }, { uci: 'b2e2', children: [{ uci: 'h9g7' }] }],
          }].map((game, index) => ({ ...game, label: 'Reviewed ' + game.id, gameMode: 'PvP', savedAt: index + 1,
            review: { summary: { totalMoves: game.moves.length, accuracy: 90, reviewedAt: 1, keyMoments: [{
              nodeId: 'old-move-99', moveIndex: 0, jumpTarget: 0, ply: 1, side: 'red', quality: 'mistake',
              swing: 100, evalBefore: 0, evalAfter: -100, playedMove: game.moves[0], bestMove: 'a0a1', note: 'Develop another piece',
            }] }, annotations: game.moves.map((_, moveIndex) => ({ moveIndex, evalScore: -100,
              quality: moveIndex ? 'good' : 'mistake', reviewNote: 'Saved explanation',
            })) },
          }));
          localStorage.setItem('xiangqi:library:v1', JSON.stringify(games));
        });
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const status = page.getByTestId('study-save-status');
        const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="study-save-status"]')?.textContent.includes('Saved study'));
        for (const id of ['compact', 'tree']) {
          const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
          await page.getByTestId('load-saved-' + id).click();
          await waitSaved();
          assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before);
          await command(page, 'Go to start');
          await command(page, 'Review panel');
          const moment = page.getByTestId('review-moment-0');
          await moment.press('Enter');
          assert.equal(await moment.getAttribute('aria-current'), 'true', 'Remapped key moments must still navigate to their reviewed move');
          await waitSaved();
          await command(page, 'Move tree');
          const metadata = page.getByTestId('game-metadata');
          if (await metadata.getAttribute('open') === null) await metadata.locator('summary').click();
          const event = metadata.getByLabel('Event', { exact: true });
          await event.fill('Changed event');
          assert.match(await status.textContent(), /Modified study/);
          await event.fill('');
          await waitSaved();
          assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before, 'Loading, navigation and reverted edits must not rewrite the review');
          await event.fill('Updated ' + id);
          await page.keyboard.press('ControlOrMeta+s');
          await waitSaved();
          const saved = await page.evaluate(id => {
            const games = JSON.parse(localStorage.getItem('xiangqi:library:v1'));
            return { count: games.length, game: games.find(game => game.id === id) };
          }, id);
          assert.equal(saved.count, 2);
          assert.equal(saved.game.metadata.event, 'Updated ' + id);
          assert.equal(saved.game.review.summary.keyMoments[0].moveIndex, 0);
          assert.equal(saved.game.review.summary.keyMoments[0].note, 'Develop another piece');
          assert.notEqual(saved.game.review.summary.keyMoments[0].nodeId, 'old-move-99');
          assert.equal(saved.game.review.annotations.length, id === 'compact' ? 1 : 2);
          await command(page, 'Library');
          await page.getByTestId('load-saved-' + id).click();
          await waitSaved();
          await command(page, 'Library');
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: reviewed compact/branch studies stay Saved across ID remapping, key-moment navigation, edit/revert, same-ID updates and reloads`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
