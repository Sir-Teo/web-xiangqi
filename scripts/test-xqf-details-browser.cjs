const assert=require('node:assert/strict');
const {browserType}=require('./qa-browser.cjs');
const base=process.env.XIANGQI_QA_URL||'http://127.0.0.1:8196/web-xiangqi/';
function file(kind,result=3,metadata=true){
 const h=Buffer.alloc(1024);h.write('XQ');h[2]=10;h[0x33]=result;
 h.set([80,70,60,50,40,30,20,10,0,72,12,83,63,43,23,3,9,19,29,39,49,59,69,79,89,17,77,6,26,46,66,86],16);
 if(metadata)for(const [offset,text] of [[0xd0,'Autumn Cup'],[0x110,'2020.06.07'],[0x120,'New York'],[0x130,'Red Player'],[0x140,'Black Player']]){h[offset]=text.length;h.write(text,offset+1);}
 const step=(uci,next=false,sibling=false)=>{const b=Buffer.alloc(8);const square=s=>(s.charCodeAt(0)-97)*10+Number(s[1]);b[0]=24+(uci?square(uci.slice(0,2)):0);b[1]=32+(uci?square(uci.slice(2)):0);b[2]=(next?0xf0:0)|(sibling?1:0);return b;};
 const root=step(null,kind!=='diagram');
 const moves=kind==='diagram'?[]:kind==='refused-main'?[step('h2e2',true),step('a9a0')]:kind==='missing-next'?[step('h2e2',true)]:kind==='replaced-main'?[step('a0a9',false,true),step('h2e2')]:kind==='refused-side'?[step('h2e2',true),step('h9g7',false,true),step('a9a0')]:[step('h2e2',true),step('h9g7')];
 return Buffer.concat([h,root,...moves]);
}
async function command(page,label){const count=label==='Save game'?await page.evaluate(()=>JSON.parse(localStorage.getItem('xiangqi:library:v1')||'[]').length):null;await page.keyboard.press('ControlOrMeta+k');await page.getByRole('combobox',{name:'Search commands'}).fill(label);await page.keyboard.press('Enter');if(count!==null)await page.waitForFunction(n=>JSON.parse(localStorage.getItem('xiangqi:library:v1')||'[]').length===n+1,count);}
async function copy(page){await command(page,'Copy PGN');return page.evaluate(()=>window.__copied);}
(async()=>{const browser=await browserType.launch();try{
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<900,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}}));
   await page.route('**/pikafish.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Pikafish=function(){};window.Pikafish.createWorkerEngine=async()=>{const listeners=[];const emit=line=>listeners.forEach(l=>l(line));return {variant:'single-simd',addMessageListener:l=>listeners.push(l),terminate(){},postMessage(c){if(c==='uci')queueMicrotask(()=>emit('uciok'));if(c==='isready')queueMicrotask(()=>emit('readyok'));if(c.startsWith('go ')||c==='stop')queueMicrotask(()=>emit('bestmove (none)'));}};};`}));
   await page.goto(base);
   for(const [kind,result,expected] of [['complete',3,'1/2-1/2'],['complete',1,'1-0'],['complete',2,'0-1'],['refused-main',3,'*'],['missing-next',3,'*'],['replaced-main',3,'*'],['refused-side',3,'1/2-1/2'],['diagram',3,'1/2-1/2'],['complete',0,'*']]){
    if(width<900)await page.getByTestId('mobile-view-board').click();
    await page.getByRole('button',{name:width<900?'Open new game menu':'Start new game',exact:true}).click();
    await page.getByTestId('uci-line-file-input').setInputFiles({name:'Study.xqf',mimeType:'application/octet-stream',buffer:file(kind,result,result!==0)});
    await page.getByTestId('uci-line-input').waitFor({state:'hidden'});
    if(['refused-main','missing-next','replaced-main'].includes(kind))assert.equal(await page.getByText('Incomplete XQF main line',{exact:true}).filter({visible:true}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const pgn=await copy(page);
    assert.ok(pgn.includes(`[Result "${expected}"]`) && pgn.trim().endsWith(expected),`${kind}: ${pgn}`);
    if(result!==0)for(const [key,value] of [['White','Red Player'],['Black','Black Player'],['Event','Autumn Cup'],['Site','New York'],['Date','2020.06.07']])assert.ok(pgn.includes(`[${key} "${value}"]`),`${key} lost: ${pgn}`);
    else assert.ok(!pgn.includes('Red Player') && !pgn.includes('Autumn Cup'),'Previous import metadata leaked');
    await command(page,'Save game');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
    assert.equal(saved.metadata?.redPlayer,result!==0?'Red Player':undefined);
    if(kind==='diagram')assert.equal(saved.rootResult,'draw');
    await command(page,'Library');
    const downloaded=page.waitForEvent('download');await page.getByTestId(`download-pgn-saved-${saved.id}`).click();
    const chunks=[];for await(const chunk of await (await downloaded).createReadStream())chunks.push(chunk);
    const exported=Buffer.concat(chunks).toString();assert.ok(exported.includes(`[Result "${expected}"]`));
    if(result!==0)assert.ok(exported.includes('[White "Red Player"]'));
    await page.getByTestId(`load-saved-${saved.id}`).click();
    const modal=page.getByRole('dialog');if(await modal.count())await page.keyboard.press('Escape');
    const reloaded=await copy(page);assert.ok(reloaded.includes(`[Result "${expected}"]`),`${kind} reload: ${reloaded}`);
    if(kind==='complete' && result===3){
     await page.keyboard.press('t');const details=page.getByTestId('game-metadata');await details.locator('summary').click();
     assert.equal(await details.getByLabel('Red player',{exact:true}).inputValue(),'Red Player');
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
     await page.screenshot({path:`/tmp/xiangqi-xqf-details-${browserType.name()}-${width}.png`});
     await command(page,'Go to start');assert.ok((await copy(page)).includes('[Result "1/2-1/2"]'));
     await command(page,'Go to latest move');
    }
    if((kind==='complete' && result===3)||kind==='diagram'){
     if(width<900)await page.getByTestId('mobile-view-board').click();
     await page.getByRole('button',{name:width<900?'Open new game menu':'Start new game',exact:true}).click();
     await page.getByTestId('uci-line-input').fill(exported);await page.getByTestId('import-uci-line-btn').click();
     await page.getByTestId('uci-line-input').waitFor({state:'hidden'});
     const imported=await copy(page);assert.ok(imported.includes('[White "Red Player"]') && imported.includes('[Result "1/2-1/2"]'));
    }
    console.log(`${browserType.name()} ${width}px ${kind}/${result}: metadata, result, PGN file, save and reload passed`);
   }
   assert.deepEqual(errors,[]);
  }finally{await page.close();}
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
