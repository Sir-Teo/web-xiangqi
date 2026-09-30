const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async()=>{const browser=await browserType.launch();try{for(const [notationStyle, move, reply] of [['uci','H2E2','H9G7'],['wxf','C2=5','H8+7'],['chinese','炮二平五','馬8進7']]){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.addInitScript(({notationStyle})=>{localStorage.setItem('xiangqi:preferences:v1',JSON.stringify({notationStyle}));localStorage.setItem('xiangqi:library:v1',JSON.stringify([{id:'notation',savedAt:1,gameMode:'PvP',moves:['h2e2','h9g7'],moveTree:[{uci:'h2e2',comment:'Cannon',children:[{uci:'h9g7',comment:'Horse'}]}]}]));},{notationStyle});
 await page.goto(base);await page.getByTestId('mobile-view-analysis').click();await page.getByTestId('mobile-analysis-tab-library').click();await page.getByTestId('practice-saved-notation').click();
 const dialog=page.getByTestId('study-practice-dialog');await dialog.getByRole('button',{name:'Show a saved move'}).click();assert.match(await page.getByTestId('study-practice-hint').innerText(),new RegExp(move.replace(/[+]/g,'\\+')));
 for(const [file,rank] of [[7,2],[4,2]])await dialog.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
 await dialog.getByRole('button',{name:'Play saved reply'}).click();assert.ok((await page.getByTestId('study-practice-status').innerText()).includes(reply));
 await page.getByTestId('study-practice-line-notes').locator('summary').click();await page.getByTestId('study-practice-line-notes').locator('li strong').nth(1).waitFor();const labels=await page.getByTestId('study-practice-line-notes').locator('li strong').allTextContents();assert.ok(labels[0].includes(move));assert.ok(labels[1].includes(reply));await page.close();
}console.log('PASS: practice hints, replies and completed notes respect UCI, WXF and Chinese notation');}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
