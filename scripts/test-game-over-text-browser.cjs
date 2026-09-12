const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
const games = [
 {id:'draw',gameMode:'PvP',savedAt:1,moves:['h2e2'],result:'draw',title:'Draw',subtitle:'Game drawn'},
 {id:'mate',gameMode:'PvP',savedAt:2,moves:['a8a0'],startFen:'3k5/r8/9/9/9/9/9/9/1r7/4K4 b - - 0 1',title:'Black Wins',subtitle:'Checkmate'},
 {id:'stalemate',gameMode:'PvP',savedAt:3,moves:[],startFen:'3k5/4R4/9/9/9/9/9/9/9/4K4 b - - 0 1',title:'Red Wins',subtitle:'No legal moves'},
];
async function command(page,label){await page.keyboard.press('ControlOrMeta+k');await page.getByRole('combobox',{name:'Search commands'}).fill(label);await page.keyboard.press('Enter');}
(async()=>{
 const browser=await browserType.launch();
 try {
  for(const viewport of [{width:320,height:480},{width:390,height:640},{width:844,height:390},{width:1440,height:900}]) {
   const page=await browser.newPage({viewport,hasTouch:viewport.width<900,reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   try {
    await page.addInitScript(games=>localStorage.setItem('xiangqi:library:v1',JSON.stringify(games)),games);
    await page.route('**/pikafish.js',route=>route.fulfill({contentType:'application/javascript',body:`
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners=[];const emit=line=>listeners.forEach(listener=>listener(line));
        return {variant:'single-simd',addMessageListener:listener=>listeners.push(listener),terminate(){},postMessage(command){
          if(command==='uci')queueMicrotask(()=>emit('uciok'));
          if(command==='isready')queueMicrotask(()=>emit('readyok'));
          if(command.startsWith('go ')||command==='stop')queueMicrotask(()=>emit('bestmove (none)'));
        }};
      };` }));
    await page.goto(base);
    for(const game of games){
     await page.evaluate(()=>document.documentElement.style.fontSize='16px');
     await command(page,'Library');await page.getByTestId(`load-saved-${game.id}`).click();
     const modal=page.getByRole('dialog',{name:game.title,exact:true});await modal.waitFor();
     const fen=await page.locator('.bottombar-fen').getAttribute('title');
     assert.match(await modal.locator('.game-over-subtitle').innerText(),new RegExp(game.subtitle,'i'));
     for(const size of [16,24,32]){
      await page.evaluate(size=>document.documentElement.style.fontSize=`${size}px`,size);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const bounds=await modal.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,overflow:el.scrollWidth-el.clientWidth};});
      assert.ok(bounds.top>=0 && bounds.bottom<=viewport.height && bounds.left>=0 && bounds.right<=viewport.width && bounds.overflow<=1,JSON.stringify({viewport,size,game:game.id,bounds}));
      for(const button of await modal.getByRole('button').all()){
       await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
       assert.ok(box.x>=0 && box.x+box.width<=viewport.width && box.y>=0 && box.y+box.height<=viewport.height && box.height>=44,JSON.stringify({viewport,size,game:game.id,box}));
      }
     }
     const newGame=modal.getByRole('button',{name:'New Game',exact:true});
     const review=modal.getByRole('button',{name:'Review',exact:true});
     await newGame.focus();await page.keyboard.press('Shift+Tab');assert.equal(await review.evaluate(el=>el===document.activeElement),true);
     await page.keyboard.press('Tab');assert.equal(await newGame.evaluate(el=>el===document.activeElement),true);
     await review.scrollIntoViewIfNeeded();
     if(game.id==='stalemate')await page.screenshot({path:`/tmp/xiangqi-game-over-text-${browserType.name()}-${viewport.width}.png`});
     await review.click();await modal.waitFor({state:'hidden'});
     assert.equal(await page.locator('.bottombar-fen').getAttribute('title'),fen,'Review changed the completed position');
     // Start a new session before checking the other action; Review intentionally
     // suppresses the same result until leaving the completed game.
     await page.evaluate(()=>document.documentElement.style.fontSize='16px');
     await command(page,'New game');
     await command(page,'Library');await page.getByTestId(`load-saved-${game.id}`).click();await modal.waitFor();
     await page.evaluate(()=>document.documentElement.style.fontSize='32px');
     await newGame.click();await modal.waitFor({state:'hidden'});
     assert.match(await page.locator('.bottombar-fen').getAttribute('title'),/^rnbakabnr\/9\/1c5c1\/p1p1p1p1p\/9\/9\/P1P1P1P1P\/1C5C1\/9\/RNBAKABNR w/);
    }
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>document.documentElement.style.fontSize='16px');
    await page.addStyleTag({content:'.game-over-modal {animation-duration:100s !important;}'});
    await command(page,'Library');await page.getByTestId('load-saved-draw').click();
    const animated=page.getByRole('dialog',{name:'Draw',exact:true});await animated.waitFor();
    const center=await animated.evaluate(el=>{
      const animation=el.getAnimations().find(a=>a.effect?.target===el);
      if(!animation)throw new Error('No entrance animation to inspect');
      animation.pause();animation.currentTime=50000;
      const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    assert.ok(Math.abs(center.x-viewport.width/2)<2 && Math.abs(center.y-viewport.height/2)<=11,JSON.stringify({viewport,center}));
    assert.deepEqual(errors,[]);
    console.log(`${browserType.name()} ${viewport.width}x${viewport.height}: draw/mate/stalemate, 100/150/200% text, bounded scrolling, focus trap, Review and New Game passed`);
   }finally{await page.close();}
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
