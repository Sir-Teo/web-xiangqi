const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const engine = `window.Pikafish = function() {};
window.Pikafish.createWorkerEngine = async () => {
 const listeners=[]; const emit=line=>listeners.forEach(listener=>listener(line));
 return {variant:'single-simd',addMessageListener:listener=>listeners.push(listener),terminate(){},postMessage(command){
  if(command==='uci')queueMicrotask(()=>emit('uciok'));
  if(command==='isready')queueMicrotask(()=>emit('readyok'));
  if(command.startsWith('go ')||command==='stop')queueMicrotask(()=>emit('bestmove (none)'));
 }};
};`;
async function assertVisibleFocus(modal, label) {
 const state = await modal.evaluate(el => {
  const active=document.activeElement;
  const r=active.getBoundingClientRect(), m=el.getBoundingClientRect();
  return {inside:el.contains(active),tag:active.tagName,text:active.textContent,
   visible:r.top>=m.top && r.bottom<=m.bottom && r.left>=m.left && r.right<=m.right};
 });
 assert.ok(state.inside && state.visible,JSON.stringify({label,...state}));
 return state;
}
(async()=>{
 const browser=await browserType.launch();
 try {
  for(const viewport of [{width:320,height:480},{width:844,height:390},{width:1440,height:900}]) {
   for(const size of [16,32]) for(const kind of ['recovery','result']) {
    const page=await browser.newPage({viewport,reducedMotion:'reduce'});
    // macOS WebKit needs Option-Tab to include buttons when Safari's full
    // keyboard navigation preference is off, as in the editor keyboard test.
    const tab=(reverse=false)=>page.keyboard.press(
     `${browserType.name()==='webkit' && process.platform==='darwin'?'Alt+':''}${reverse?'Shift+':''}Tab`
    );
    const label=`${browserType.name()} ${viewport.width}x${viewport.height} ${size}px ${kind}`;
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    try {
     // Apply the reader's text size before React mounts, rather than enlarging
     // an already-open dialog whose initial focus has already been chosen.
     await page.route('**/*.css',async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text())+`\nhtml {font-size:${size}px!important;}`});
     });
     await page.route('**/pikafish.js',route=>route.fulfill({contentType:'application/javascript',body:engine}));
     await page.addInitScript(kind=>{
      if(kind==='recovery')localStorage.setItem('xiangqi:auto-saved-game:v1',JSON.stringify({version:1,savedAt:Date.now(),game:{id:'auto-save',savedAt:Date.now(),gameMode:'PvP',moves:['h2e2']}}));
      else localStorage.setItem('xiangqi:library:v1',JSON.stringify([{id:'stalemate',gameMode:'PvP',savedAt:1,moves:[],startFen:'3k5/4R4/9/9/9/9/9/9/9/4K4 b - - 0 1'}]));
     },kind);
     await page.goto(base+'?moves=b2e2');
     if(kind==='result') {
      await page.locator('.xiangqi-board').waitFor();
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox',{name:'Search commands'}).fill('Library');
      await page.keyboard.press('Enter');await page.getByTestId('load-saved-stalemate').click();
     }
     const modal=page.getByRole('dialog',{name:kind==='recovery'?'Unfinished game':'Red Wins',exact:true});
     await modal.waitFor();
     await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.contains(document.activeElement));
     const initial=await assertVisibleFocus(modal,label);
     if(viewport.width===320 && size===32)await page.screenshot({path:`/tmp/xiangqi-dialog-initial-${browserType.name()}-${kind}.png`});
     const overflowing=await modal.evaluate(el=>el.scrollHeight>el.clientHeight+1);
     assert.equal(initial.tag,overflowing?'H2':'BUTTON',label);
     const primary=modal.getByRole('button',{name:kind==='recovery'?'Restore':'New Game',exact:true});
     const secondary=modal.getByRole('button',{name:kind==='recovery'?"Keep the link's game":'Review',exact:true});
     const last=kind==='recovery'?modal.getByRole('button',{name:'Decide later',exact:true}):secondary;
     if(overflowing) {
      await page.keyboard.press('Enter'); // Reading the title must not start/reset a game.
      assert.equal(await modal.count(),1,label);
     }
     await tab(true);
     assert.equal(await last.evaluate(el=>el===document.activeElement),true,label);
     await assertVisibleFocus(modal,label+' reverse');
     await tab();
     assert.equal(await primary.evaluate(el=>el===document.activeElement),true,label);
     await assertVisibleFocus(modal,label+' forward wrap');
     if(overflowing) {
      await modal.getByRole('heading').focus();await tab();
      assert.equal(await primary.evaluate(el=>el===document.activeElement),true,label);
      await assertVisibleFocus(modal,label+' from heading');
     }
     await tab();
     assert.equal(await secondary.evaluate(el=>el===document.activeElement),true,label);
     const fen=await page.locator('.bottombar-fen').getAttribute('title');
     await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
     assert.equal(await page.locator('.bottombar-fen').getAttribute('title'),fen,label+' Escape preserves current board');
     assert.deepEqual(errors,[]);console.log(label+': visible initial focus, keyboard traversal and Escape passed');
    }finally{await page.close();}
   }
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
