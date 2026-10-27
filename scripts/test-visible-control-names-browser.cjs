const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, name) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(name);
  await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, acceptDownloads: true });
      page.setDefaultTimeout(10000);
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'visible-names', savedAt: 1, gameMode: 'PvP', label: 'Voice study', moves: ['h2e2'] },
        ])));
        await page.goto(base); await page.locator('.xiangqi-board').first().waitFor();
        if (width < 900) {
          await page.getByRole('button', { name: /^Analyze this position$/ }).waitFor();
          await page.getByTestId('mobile-more-actions-btn').click();
          await page.getByRole('menuitem', { name: 'Open commands', exact: true }).click();
        } else await page.getByRole('button', { name: 'Open commands', exact: true }).click();
        const input = page.getByRole('combobox', { name: 'Search commands' });
        await input.waitFor(); await page.keyboard.press('Escape');
        if (width >= 900) {
          // An opening's visible Chinese name must be available to voice input
          // alongside its notation, English name, and number of continuations.
          await page.getByRole('button', { name: /C2=5.*Central Cannon.*中炮/ }).click();
        } else {
          const board = page.locator('.xiangqi-board').first();
          for (const [file, rank] of [[7, 2], [4, 2]]) await board.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
        }
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        if (width < 900) {
          await page.getByTestId('mobile-more-actions-btn').click();
          const share = page.getByRole('menuitem', { name: 'Copy link to this position', exact: true });
          await share.waitFor(); assert.equal(await share.isEnabled(), true);
          await page.getByRole('menuitem', { name: 'Save game in this browser', exact: true }).waitFor();
          await page.getByRole('menuitem', { name: 'Copy FEN for this position', exact: true }).waitFor();
          await page.keyboard.press('Escape');
          await page.getByTestId('mobile-view-analysis').click();
          await page.getByTestId('mobile-analysis-tab-moves').click();
          await page.getByRole('button', { name: /Black to move.*Return to board/ }).waitFor();
        } else {
          const share = page.getByRole('button', { name: 'Copy link to this position', exact: true });
          await share.waitFor(); assert.equal(await share.isEnabled(), true);
        }
        await command(page, 'Library');
        const file = page.getByRole('button', { name: 'Download PGN file for Voice study', exact: true });
        const [download] = await Promise.all([page.waitForEvent('download'), file.click()]);
        assert.match(download.suggestedFilename(), /\.pgn$/);
        await page.getByRole('button', { name: 'Saved PGN file for Voice study', exact: true }).waitFor();
        await command(page, 'Import a game record');
        await page.getByRole('button', { name: /^Local board\s+Two players/ }).waitFor();
        console.log(`${browserType.name()} ${width}px: Commands, Analyze, opening names, Copy Link, File/Saved, position context and mode labels remain addressable through their visible words`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-control-names-${browserType.name()}-${width}-failure.png` });
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
