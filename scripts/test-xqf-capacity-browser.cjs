const assert=require('node:assert/strict');
const {browserType}=require('./qa-browser.cjs');
const base=process.env.XIANGQI_QA_URL||'http://127.0.0.1:8196/web-xiangqi/';
function file(count,shape='line'){
 const h=Buffer.alloc(1024);h.write('XQ');h[2]=10;
 h.set([80,70,60,50,40,30,20,10,0,72,12,83,63,43,23,3,9,19,29,39,49,59,69,79,89,17,77,6,26,46,66,86],16);
 const r=Buffer.alloc((count+1)*8);r[0]=24;r[1]=32;r[2]=240;
 const cycle=['h0g2','h9g7','g2h0','g7h9'],square=s=>(s.charCodeAt(0)-97)*10+Number(s[1]);
 for(let i=0;i<count;i++){
  const m=shape==='wide'?'h2e2':shape==='refused'?'a0a9':cycle[i%4],o=(i+1)*8;
  r[o]=24+square(m.slice(0,2));r[o+1]=32+square(m.slice(2));r[o+2]=i<count-1?(shape==='wide'?1:240):0;
 }
 return Buffer.concat([h,r]);
}
async function openImport(page,width){
 if(width<900)await page.getByTestId('mobile-view-board').click();
 await page.getByRole('button',{name:width<900?'Open new game menu':'Start new game',exact:true}).click();
}
(async()=>{const browser=await browserType.launch();try{
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:width===320?640:900},hasTouch:width<900,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.route('**/pikafish.js',route=>route.fulfill({contentType:'application/javascript',body:`window.Pikafish=function(){};window.Pikafish.createWorkerEngine=async()=>{const ls=[];const e=s=>ls.forEach(l=>l(s));return{variant:'single-simd',addMessageListener:l=>ls.push(l),terminate(){},postMessage:c=>{if(c==='uci')queueMicrotask(()=>e('uciok'));if(c==='isready')queueMicrotask(()=>e('readyok'));if(c.startsWith('go ')||c==='stop')queueMicrotask(()=>e('bestmove (none)'));}};};`}));
   await page.goto(base);await openImport(page,width);
   await page.getByTestId('uci-line-input').fill('[Event "Existing study"] {Keep this root note} 1.h2e2 {Keep this move note} *');
   await page.getByTestId('import-uci-line-btn').click();await page.getByTestId('uci-line-input').waitFor({state:'hidden'});
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')||'null')?.game?.metadata?.event==='Existing study');
   const original=await page.evaluate(()=>({fen:document.querySelector('.bottombar-fen').getAttribute('title'),recovery:localStorage.getItem('xiangqi:auto-saved-game:v1')}));
   await openImport(page,width);
   for(const [count,shape] of [[1025,'line'],[1025,'wide'],[8192,'line'],[8192,'refused']]){
    await page.getByTestId('uci-line-file-input').setInputFiles({name:'Large.xqf',mimeType:'application/octet-stream',buffer:file(count,shape)});
    await page.getByText('XQF file is too large. Import 1024 moves or fewer across all variations.',{exact:true}).waitFor({timeout:5000});
    assert.equal(await page.getByTestId('uci-line-input').isVisible(),true,'Oversized import closed the dialog');
    const current=await page.evaluate(()=>({fen:document.querySelector('.bottombar-fen').getAttribute('title'),recovery:localStorage.getItem('xiangqi:auto-saved-game:v1')}));
    assert.deepEqual(current,original,'Rejected file changed the board or recovery snapshot');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    console.log(`${browserType.name()} ${width}px: ${count} ${shape} rejected before replacing the study`);
   }
   await page.getByText('XQF file is too large. Import 1024 moves or fewer across all variations.',{exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:`/tmp/xiangqi-xqf-capacity-${browserType.name()}-${width}.png`});
   // Exactly the existing capacity remains usable, including automatic recovery.
   await page.getByTestId('uci-line-file-input').setInputFiles({name:'Boundary.xqf',mimeType:'application/octet-stream',buffer:file(1024)});
   await page.getByTestId('uci-line-input').waitFor({state:'hidden'});
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xiangqi:auto-saved-game:v1')||'null')?.game?.moves?.length===1024);
   const endpoint=await page.locator('.bottombar-fen').getAttribute('title');
   await page.reload();await page.getByRole('button',{name:'Restore',exact:true}).click();
   await page.waitForFunction(fen=>document.querySelector('.bottombar-fen')?.getAttribute('title')===fen,endpoint);
   assert.match(await page.locator('.wc-meta').innerText(),/1024\s*\/\s*1024/);
   assert.deepEqual(errors,[]);console.log(`${browserType.name()} ${width}px: 1024-move import and reload recovery passed`);
  }finally{await page.close();}
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
