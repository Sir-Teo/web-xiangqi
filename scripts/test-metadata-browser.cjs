const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
(async () => {
 const browser = await chromium.launch();
 try {
  for (const width of [1440,390]) {
   const page = await browser.newPage({viewport:{width,height:900},acceptDownloads:true});
   await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([{
    id:'metadata',savedAt:1,gameMode:'PvP',label:'My study',moves:['h2e2'],
    metadata:{redPlayer:'王 "A"',blackPlayer:'李',event:'Championship',date:'2020.??.??',round:'3.2',site:'Denver'},
   }])));
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   await page.goto(base);
   await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
   const pending = page.waitForEvent('download');
   await page.getByTestId('download-pgn-saved-metadata').click();
   const download = await pending;
   const pgn=fs.readFileSync(await download.path(),'utf8');
   for(const tag of ['[White "王 \\"A\\""]','[Black "李"]','[Event "Championship"]','[Date "2020.??.??"]','[Round "3.2"]','[Site "Denver"]']) assert.ok(pgn.includes(tag), `${tag} missing from ${pgn}`);
   await page.getByTestId('load-saved-metadata').click();
   if (width < 900) await page.getByTestId('mobile-analysis-tab-moves').click();
   const editor = page.getByTestId('game-metadata');
   await editor.locator('summary').click();
   assert.equal(await editor.getByLabel('Red player', {exact:true}).inputValue(), '王 "A"');
   // Import a fresh PGN through the user-facing dialog.
   if (width < 900) await page.getByTestId('mobile-view-board').click();
   await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact:true }).click();
   await page.getByTestId('uci-line-input').fill('[White "Alice"]\n[Black "Bob"]\n[Event "Open Cup"]\n[Date "2020.??.??"]\n[Round "2"]\n[Site "Paris"]\n\n1. h2e2 h9g7 *');
   await page.getByTestId('import-uci-line-btn').click();
   if (width < 900) {
    await page.getByTestId('mobile-view-analysis').click();
    await page.getByTestId('mobile-analysis-tab-moves').click();
   }
   if (await editor.getAttribute('open') === null) await editor.locator('summary').click();
   assert.equal(await editor.getByLabel('Red player',{exact:true}).inputValue(), 'Alice');
   assert.equal(await editor.getByLabel('Black player',{exact:true}).inputValue(), 'Bob');
   assert.equal(await editor.getByLabel('Game date').inputValue(), '2020.??.??');
   await editor.getByLabel('Event',{exact:true}).fill('Autumn Invitational');
   await editor.getByLabel('Red player',{exact:true}).fill('Alice Smith');
   await editor.scrollIntoViewIfNeeded();
   await page.screenshot({path:`/tmp/xiangqi-metadata-${width}.png`});
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   if (width < 900) await page.getByTestId('mobile-view-board').click();
   await page.getByTestId(width < 900 ? 'mobile-save-game-btn' : 'save-game-btn').click();
   await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
   await page.getByRole('searchbox', { name: 'Search library' }).fill('Autumn Invitational');
   assert.match(await page.locator('[data-testid^="metadata-saved-"]').innerText(), /Red: Alice Smith · Black: Bob/);
   await page.screenshot({path:`/tmp/xiangqi-metadata-library-${width}.png`});
   const saved = page.locator('[data-testid^="load-saved-"]');
   assert.equal(await saved.count(),1,'Tournament search finds edited game');
   await saved.click();
   if (width < 900) await page.getByTestId('mobile-analysis-tab-moves').click();
   if (await editor.getAttribute('open') === null) await editor.locator('summary').click();
   assert.equal(await editor.getByLabel('Red player',{exact:true}).inputValue(), 'Alice Smith');
   assert.equal(await editor.getByLabel('Event',{exact:true}).inputValue(), 'Autumn Invitational');
   if (width < 900) await page.getByTestId('mobile-view-board').click();
   if (width < 900) await page.getByTestId('mobile-more-actions-btn').click();
   const currentDownload = page.waitForEvent('download');
   await page.getByTestId(width < 900 ? 'mobile-download-pgn-btn' : 'download-pgn-btn').click();
   const currentPgn = fs.readFileSync(await (await currentDownload).path(),'utf8');
   assert.ok(currentPgn.includes('[White "Alice Smith"]'));
   assert.ok(currentPgn.includes('[Event "Autumn Invitational"]'));
   assert.ok(currentPgn.includes('[Date "2020.??.??"]'));
   await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1') || 'null')?.game.metadata?.redPlayer === 'Alice Smith');
   await page.reload();
   await page.getByRole('button', {name:'Restore',exact:true}).click();
   if (width < 900) await page.getByTestId('mobile-analysis-tab-moves').click();
   if (await editor.getAttribute('open') === null) await editor.locator('summary').click();
   assert.equal(await editor.getByLabel('Red player',{exact:true}).inputValue(), 'Alice Smith');
   assert.equal(await editor.getByLabel('Event',{exact:true}).inputValue(), 'Autumn Invitational');
   if (width < 900) await page.getByTestId('mobile-view-board').click();
   // Importing a headerless game must clear facts from the previous game.
   await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact:true }).click();
   await page.getByTestId('uci-line-input').fill('1. h2e2 *');
   await page.getByTestId('import-uci-line-btn').click();
   if (width < 900) {
    await page.getByTestId('mobile-view-analysis').click();
    await page.getByTestId('mobile-analysis-tab-moves').click();
   }
   if (await editor.getAttribute('open') === null) await editor.locator('summary').click();
   assert.equal(await editor.getByLabel('Red player',{exact:true}).inputValue(), '');
   assert.equal(await editor.getByLabel('Event',{exact:true}).inputValue(), '');
   assert.deepEqual(errors, []);
   await page.close();
  }
  console.log('PASS: desktop/mobile tournament metadata import, edit, save, search, reload, export and reset');
 } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1});
