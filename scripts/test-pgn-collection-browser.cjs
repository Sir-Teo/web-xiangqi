const assert = require('node:assert/strict');
const fs = require('node:fs');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5174/web-xiangqi/';
const source = '[White "Alice"] [Black "Bob"] [Event "Open Cup"] [Result "1-0"] [WhiteElo "2500"] [BlackElo "2450"] [TimeControl "40/7200:3600"] [Annotator "Coach 王"]\n1.h2e2 {Main note} (1.b2e2 {Branch note}) h9g7 1-0\n[White "Carol"] [Black "Dan"]\n1.b2e2 *';
async function checkEnlargedDetails(page, details, name) {
 const original = await details.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
 await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 assert.equal(await details.evaluate(node => parseFloat(getComputedStyle(node).fontSize)), original * 2, `${name} must grow with enlarged text`);
 await details.scrollIntoViewIfNeeded();
 assert.equal(await details.evaluate(node => node.scrollWidth > node.clientWidth), false, `${name} must wrap`);
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} must fit the viewport`);
 await page.screenshot({path:`/tmp/xiangqi-collection-text-${browserType.name()}-${page.viewportSize().width}-${name}.png`});
}
async function resetText(page) {
 await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
(async () => {
 const browser = await browserType.launch();
 try {
  for (const width of [1440,390,320]) {
   const page = await browser.newPage({viewport:{width,height:width === 320 ? 640 : width === 390 ? 844 : 900},hasTouch:width < 900,acceptDownloads:true});
   const errors=[]; page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'?moves=h2e2');
   // Link hydration runs after the first render; compare with the requested
   // position, not the initial board briefly rendered before it loads.
   await page.waitForFunction(() => document.querySelector('.bottombar-fen')?.getAttribute('title') ===
     'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1');
   const beforeFen = await page.locator('.bottombar-fen').getAttribute('title');
   await page.getByTestId(width<900 ? 'mobile-open-library-btn':'left-panel-tab-library').click();
   const panel=page.getByTestId('pgn-collection-import');
   await panel.locator('summary').click();
   const file=panel.getByLabel('Choose PGN collection');
   const upload=text=>file.setInputFiles({name:'Tournament'.repeat(20)+'.pgn',mimeType:'application/x-chess-pgn',buffer:Buffer.from(text)});
   const raw=()=>page.evaluate(()=>localStorage.getItem('xiangqi:library:v1'));
   const before=await raw();
   const started = Date.now();
   await upload('h2e2 {' + '[%xqanalysis '.repeat(74000) + '} *');
   await panel.getByRole('alert').filter({hasText:'A move note exceeds 500 characters.'}).waitFor({timeout:5000});
   assert.equal(await raw(),before, 'Rejecting the malformed note changed saved games');
   console.log(`${browserType.name()}: 962 KB malformed note rejected at ${width}px in ${Date.now()-started}ms (file selection through visible error)`);
   await upload(source+'\n1.h2e2 h9h8 *');
   await panel.getByRole('alert').waitFor();
   assert.match(await panel.getByRole('alert').innerText(), /Game 3: Illegal move h9h8/);
   assert.equal(await raw(),before);
   // Search reaches beyond the initial render page. Filtering never silently
   // changes selection, and bulk actions affect all matches, including those
   // that have not been rendered yet.
   const collection = Array.from({length:45}, (_, index) =>
    `[White "Player ${index + 1}"] [Event "${index % 2 ? 'Even Cup' : 'Odd Cup'}"] [Annotator "Coach 王"]\n1.h2e2 *`).join('\n');
   await upload(collection);
   await panel.getByRole('button',{name:'Import 45 games',exact:true}).waitFor();
   const rows = panel.locator('.lib-pgn-game');
   const search = panel.getByRole('searchbox', {name:'Find games in this collection'});
   assert.equal(await rows.count(),20,'Initial preview must stay bounded');
   await panel.getByRole('button',{name:'Show 20 more games',exact:true}).click();
   assert.equal(await rows.count(),40);
   await panel.locator('.lib-pgn-games').evaluate(element => { element.scrollTop = element.scrollHeight; });
   await search.fill('王 PLAYER 45');
   assert.equal(await rows.count(),1);
   assert.match(await rows.first().innerText(),/45\. Player 45/);
   assert.equal(await rows.getByRole('checkbox').isChecked(),true);
   assert.match(await panel.innerText(),/44 selected games are outside this search/);
   await panel.getByRole('button',{name:'Deselect matches',exact:true}).click();
   assert.equal(await panel.getByRole('button',{name:'Import 44 games',exact:true}).isEnabled(),true);
   await panel.getByRole('button',{name:'Select only matches',exact:true}).click();
   assert.equal(await panel.getByRole('button',{name:'Import 1 game',exact:true}).isEnabled(),true);
   assert.equal(await rows.getByRole('checkbox').isChecked(),true,'Selecting only matches includes the visible match');
   await search.fill('missing player');
   assert.equal(await rows.count(),0);
   assert.equal(await panel.getByRole('button',{name:'Select all matches',exact:true}).isDisabled(),true);
   await search.fill('');
   assert.equal(await rows.count(),20,'Changing the search resets pagination');
   assert.equal(await panel.locator('.lib-pgn-games').evaluate(element => element.scrollTop),0,
    'A new search must start at the first matching game');
   await panel.getByRole('button',{name:'Select none',exact:true}).click();
   await search.fill('ODD CUP');
   assert.equal(await rows.count(),20,'Matching results are paginated too');
   await panel.getByRole('button',{name:'Select all matches',exact:true}).click();
   assert.equal(await panel.getByRole('button',{name:'Import 23 games',exact:true}).isEnabled(),true);
   await search.fill('player 45');
   assert.equal(await rows.getByRole('checkbox').isChecked(),true,'Bulk selection reaches unrendered matches');
   assert.equal(await raw(),before,'Search and selection do not write to the library');
   await upload(source);
   await panel.getByRole('button',{name:'Import 2 games',exact:true}).waitFor();
   assert.equal(await search.inputValue(),'','A replacement file clears the old search');
   assert.match(await panel.locator('.lib-pgn-game strong').first().innerText(), /Alice \(2500\).*Bob \(2450\)/);
   assert.match(await panel.innerText(), /ratings.*recorded time control.*annotator credits/);
   assert.equal(await raw(),before,'Preview does not save');
   assert.equal(await page.locator('.bottombar-fen').getAttribute('title'),beforeFen);
   await checkEnlargedDetails(page, panel.locator('.lib-pgn-game span span').first(), 'preview');
   await panel.locator('.lib-pgn-games').getByRole('checkbox').last().uncheck();
   assert.equal(await panel.getByRole('button',{name:'Import 1 game',exact:true}).isEnabled(),true);
   await panel.getByRole('button',{name:'Select none',exact:true}).click();
   assert.equal(await panel.getByRole('button',{name:'Import 0 games',exact:true}).isDisabled(),true);
   await panel.getByRole('button',{name:'Select all',exact:true}).click();
   await panel.getByRole('button',{name:'Import 2 games',exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:`/tmp/xiangqi-collection-preview-${browserType.name()}-${width}.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const overflow = await panel.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, children: [...el.querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > el.getBoundingClientRect().right).map(node => ({tag:node.tagName, class:node.className, text:node.textContent.slice(0,100), width:node.clientWidth, scroll:node.scrollWidth})) }));
   assert.equal(overflow.scroll > overflow.width,false,`Long filenames and enlarged collection content must wrap: ${JSON.stringify(overflow)}`);
   await panel.getByRole('button',{name:'Import 2 games',exact:true}).click();
   await panel.getByRole('status').filter({hasText:'Imported 2 games.'}).waitFor();
   assert.equal(await file.evaluate(element => element === document.activeElement),true,'Finishing import restores keyboard focus');
   const games=JSON.parse(await raw());
   assert.equal(games.length,2);
   const alice=games.find(game=>game.metadata.redPlayer==='Alice');
   assert.equal(alice.result,'red');
   assert.equal(alice.moveTree[1].comment,'Branch note');
   assert.deepEqual(alice.metadata, {redPlayer:'Alice',blackPlayer:'Bob',event:'Open Cup',redRating:'2500',blackRating:'2450',timeControl:'40/7200:3600',annotator:'Coach 王'});
   assert.equal(await page.locator('.bottombar-fen').getAttribute('title'),beforeFen,'Saving leaves board untouched');
   await resetText(page);
   await checkEnlargedDetails(page, page.getByTestId(`metadata-saved-${alice.id}`), 'metadata');
   const download=page.waitForEvent('download');
   await page.getByTestId(`download-pgn-saved-${alice.id}`).click();
   const pgn=fs.readFileSync(await (await download).path(),'utf8');
   assert.ok(pgn.includes('Branch note') && pgn.includes('(') && pgn.includes('[White "Alice"]'));
   for(const tag of ['[WhiteElo "2500"]','[BlackElo "2450"]','[TimeControl "40/7200:3600"]','[Annotator "Coach 王"]']) assert.ok(pgn.includes(tag), `Collection export lost ${tag}`);
   await resetText(page);
   await upload(source);
   await panel.getByRole('button',{name:'Import 0 games',exact:true}).waitFor();
   await panel.getByRole('button',{name:'Import 0 games',exact:true}).click();
   await panel.getByRole('status').filter({hasText:'Skipped 2 duplicates.'}).waitFor();
   // Failed writes preserve the current library and leave the preview available.
   await upload(source);
   await panel.getByRole('checkbox',{name:'Import duplicates as copies'}).check();
   await panel.getByRole('button',{name:'Import 2 games',exact:true}).waitFor();
   await page.evaluate(()=>{ const original=Storage.prototype.setItem; Storage.prototype.setItem=function(key,value){if(key==='xiangqi:library:v1')throw new Error('Quota'); return original.call(this,key,value);}; });
   const original=await raw();
   await panel.getByRole('button',{name:'Import 2 games',exact:true}).click();
   await panel.getByRole('alert').waitFor();
   assert.equal(await raw(),original);
   assert.equal(await panel.getByRole('button',{name:'Import 2 games',exact:true}).evaluate(element => element === document.activeElement),true,
    'A failed import keeps keyboard focus on Retry');
   assert.equal(await panel.getByRole('checkbox').count(),3);
   await panel.getByRole('button',{name:'Cancel import',exact:true}).click();
   assert.equal(await panel.getByRole('checkbox').count(),0);
   assert.equal(await file.evaluate(element => element === document.activeElement),true,'Canceling import restores keyboard focus');
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS: desktop/mobile collection worker preview, selection, illegal-game rejection, atomic save, metadata/branch export, unchanged board and quota protection');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
