const assert=require('node:assert/strict');const fs=require('node:fs/promises');const {browserType}=require('./qa-browser.cjs');const base=process.env.XIANGQI_QA_URL||'http://127.0.0.1:5173/web-xiangqi/';
(async()=>{const browser=await browserType.launch();try{for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:844}});const raw=JSON.stringify([{id:'a',savedAt:1,gameMode:'PvP',label:'Readable study',moves:['h2e2']},{bad:true}]);
 await page.addInitScript(raw=>localStorage.setItem('xiangqi:library:v1',raw),raw);await page.goto(base);await page.locator('.xiangqi-board').waitFor();await page.keyboard.press('ControlOrMeta+k');await page.getByRole('combobox').fill('Library');await page.keyboard.press('Enter');
 await page.getByText('Review readable studies for recovery',{exact:true}).click();await page.getByRole('button',{name:'Keep 1 readable studies'}).click();await page.getByText(/Recovered 1 studies/).waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('xiangqi:library:v1')).length),1);
 await page.locator('.lib-transfer summary').filter({hasText:'Backup and restore'}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download archived original'}).click();assert.equal(await fs.readFile(await(await download).path(),'utf8'),raw);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
}console.log('PASS: guided salvage keeps readable records and downloads exact archived original at three widths');}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
