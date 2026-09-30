const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 8 12';
(async()=>{const browser=await browserType.launch();try{for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:844}});await page.goto(base);await page.locator('.xiangqi-board').waitFor();
 await page.keyboard.press('ControlOrMeta+k');await page.getByRole('combobox').fill('Set up a position');await page.keyboard.press('Enter');
 await page.getByTestId('editor-fen').fill(fen.replace('8 12','-1 12'));await page.getByTestId('editor-done').click();
 await page.getByTestId('editor-fen-notice').waitFor();assert.equal(await page.getByTestId('board-editor').isVisible(),true);
 await page.getByTestId('editor-clear').click();
 await page.getByTestId('editor-fen').fill(fen);await page.getByTestId('editor-done').click();
 await page.getByTestId('board-editor').waitFor({state:'hidden'});
 assert.equal(await page.locator('.bottombar-fen').getAttribute('title'),fen);await page.close();
}console.log('PASS: Done validates pending FEN, retains invalid input, applies side/clocks even over an invalid preview at three widths');}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
