const assert=require('node:assert/strict');const {browserType}=require('./qa-browser.cjs');const base=process.env.XIANGQI_QA_URL||'http://127.0.0.1:5173/web-xiangqi/';
(async()=>{const browser=await browserType.launch();try{for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:844}});await page.addInitScript(()=>localStorage.setItem('xiangqi:library:v1',JSON.stringify([{id:'progress',savedAt:1,gameMode:'PvP',moves:['h2e2','h9g7']}])));
 const open=async()=>{await page.locator('.xiangqi-board').waitFor();await page.keyboard.press('ControlOrMeta+k');await page.getByRole('combobox').fill('Library');await page.keyboard.press('Enter');await page.getByTestId('practice-saved-progress').click();await page.getByTestId('study-practice-progress').waitFor();};
 await page.goto(base);await open();const dialog=page.getByTestId('study-practice-dialog');
 for(const [file,rank]of[[7,2],[4,2]])await dialog.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`).click();
 await dialog.getByRole('button',{name:'Play saved reply'}).waitFor();await page.reload();await open();
 await dialog.getByRole('button',{name:'Play saved reply'}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="study-practice-progress"]').textContent.startsWith('1 of 1'));
 await dialog.getByRole('combobox',{name:'Practice as'}).selectOption('b');assert.match(await page.getByTestId('study-practice-progress').innerText(),/0 of 1/);
 await dialog.getByRole('combobox',{name:'Practice as'}).selectOption('w');assert.match(await page.getByTestId('study-practice-progress').innerText(),/1 of 1/);
 await dialog.getByRole('button',{name:'Reset progress for this side'}).click();assert.match(await page.getByTestId('study-practice-progress').innerText(),/0 of 1/);await page.close();
}console.log('PASS: practice resumes after reload, keeps separate sides, completes and resets at three widths');}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
