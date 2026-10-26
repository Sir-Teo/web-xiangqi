const assert=require('node:assert/strict');const fs=require('node:fs/promises');const {browserType}=require('./qa-browser.cjs');const base=process.env.XIANGQI_QA_URL||'http://127.0.0.1:5173/web-xiangqi/';
(async()=>{const browser=await browserType.launch();try{for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:844}});const raw=JSON.stringify([{id:'a',savedAt:1,gameMode:'PvP',label:'Readable study',moves:['h2e2']},{bad:true}]);
 await page.addInitScript(raw=>localStorage.setItem('xiangqi:library:v1',raw),raw);await page.goto(base);await page.locator('.xiangqi-board').waitFor();await page.keyboard.press('ControlOrMeta+k');await page.getByRole('combobox').fill('Library');await page.keyboard.press('Enter');
 await page.getByText('Review readable studies for recovery',{exact:true}).click();
 const repair=page.getByRole('button',{name:'Keep 1 readable studies',exact:true});
 await page.evaluate(()=>{
  const set=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){
   if((window.__refuseRepair==='archive'&&key.startsWith('xiangqi:library-recovery:v1:'))||
      (window.__refuseRepair==='library'&&key==='xiangqi:library:v1'))throw new Error('Quota');
   return set.call(this,key,value);
  };
 });
 for(const [kind,message]of[['archive','Storage could not preserve the original file'],['library','Storage refused the repaired library']]){
  await page.evaluate(kind=>{window.__refuseRepair=kind;},kind);
  await repair.focus();await repair.press('Enter');
  await page.getByRole('alert').filter({hasText:message}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('xiangqi:library:v1')),raw,'A refused repair preserves the exact original library');
  assert.equal(await repair.isEnabled(),true,'Repair remains available after storage failure');
  assert.equal(await repair.evaluate(e=>e===document.activeElement),true,'A failed repair retains keyboard focus for retry');
 }
 await page.evaluate(()=>{window.__refuseRepair=null;});
 await repair.press('Enter');await page.getByText(/Recovered 1 studies/).waitFor();
 assert.equal(await page.locator('.lib-transfer summary').filter({hasText:'Backup and restore'}).evaluate(e=>e===document.activeElement),true,
  'Successful keyboard repair continues at backup controls when its button disappears');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('xiangqi:library:v1')).length),1);
 await page.locator('.lib-transfer summary').filter({hasText:'Backup and restore'}).click();
 const recovery=page.getByRole('region',{name:'Library backup and recovery',exact:true});
 const archived=page.getByRole('button',{name:'Download archived original',exact:true});
 const saved=await page.evaluate(()=>localStorage.getItem('xiangqi:library:v1'));
 let downloads=0;page.on('download',()=>downloads++);
 await page.evaluate(()=>{
  const create=URL.createObjectURL.bind(URL);window.__denyArchivedDownload=true;
  URL.createObjectURL=blob=>{if(window.__denyArchivedDownload&&blob.type.startsWith('application/json'))throw new Error('Download denied');return create(blob);};
 });
 await archived.click();await recovery.getByRole('alert').filter({hasText:'The download could not start'}).waitFor();
 assert.equal(await recovery.locator('.lib-transfer-status').textContent(),'','A failed download clears stale repair or success messages');
 assert.equal(downloads,0,'A failed download creates no file');
 await page.evaluate(()=>{window.__denyArchivedDownload=false;});
 const download=page.waitForEvent('download');await archived.click();const file=await download;
 assert.equal(file.suggestedFilename(),'xiangqi-library-original-recovery.json');
 assert.equal(await fs.readFile(await file.path(),'utf8'),raw);
 await recovery.getByRole('status').filter({hasText:'Archived original download started'}).waitFor();
 assert.equal(await recovery.getByRole('alert').count(),0,'A successful retry clears its previous error');
 await page.evaluate(()=>{window.__denyArchivedDownload=true;});
 await archived.click();await recovery.getByRole('alert').filter({hasText:'The download could not start'}).waitFor();
 assert.equal(await recovery.locator('.lib-transfer-status').textContent(),'','A failed retry clears the previous success message');
 assert.equal(downloads,1,'Only the successful retry downloads a file');
 assert.equal(await page.evaluate(()=>localStorage.getItem('xiangqi:library:v1')),saved,'Recovery downloads do not alter saved studies');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
}console.log('PASS: guided salvage keeps readable records and downloads exact archived original with retryable feedback at three widths');}finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
