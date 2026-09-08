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
   await page.goto(base);
   await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
   const pending = page.waitForEvent('download');
   await page.getByTestId('download-pgn-saved-metadata').click();
   const download = await pending;
   const pgn=fs.readFileSync(await download.path(),'utf8');
   for(const tag of ['[White "王 \\"A\\""]','[Black "李"]','[Event "Championship"]','[Date "2020.??.??"]','[Round "3.2"]','[Site "Denver"]']) assert.ok(pgn.includes(tag), `${tag} missing from ${pgn}`);
   await page.close();
  }
  console.log('PASS: saved tournament metadata survives desktop/mobile PGN downloads');
 } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1});
