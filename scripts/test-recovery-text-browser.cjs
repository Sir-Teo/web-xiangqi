const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const viewport of [{width:320,height:480},{width:390,height:640},{width:844,height:390},{width:1440,height:900}]) {
      for (const restore of [true, false]) {
        const page = await browser.newPage({viewport,hasTouch:viewport.width<900,reducedMotion:'reduce'});
        const errors=[]; page.on('pageerror',e=>errors.push(e.message));
        try {
          await page.addInitScript(()=>localStorage.setItem('xiangqi:auto-saved-game:v1',JSON.stringify({version:1,savedAt:Date.now(),game:{id:'auto-save',savedAt:Date.now(),gameMode:'PvP',moves:['h2e2']}})));
          await page.route('**/pikafish.js', route => route.fulfill({contentType:'application/javascript',body:`
            window.Pikafish = function() {};
            window.Pikafish.createWorkerEngine = async () => {
              const listeners=[]; const emit=line=>listeners.forEach(listener=>listener(line));
              return {variant:'single-simd',addMessageListener:listener=>listeners.push(listener),terminate(){},postMessage(command){
                if(command==='uci')queueMicrotask(()=>emit('uciok'));
                if(command==='isready')queueMicrotask(()=>emit('readyok'));
                if(command.startsWith('go ')||command==='stop')queueMicrotask(()=>emit('bestmove (none)'));
              }};
            };` }));
          await page.goto(base+'?moves=b2e2');
          const modal=page.getByRole('dialog',{name:'Unfinished game'});
          await modal.waitFor();
          for(const size of [16,24,32]) {
            await page.addStyleTag({content:`html {font-size:${size}px!important;}`});
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            const geometry=await modal.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,horizontal:el.scrollWidth-el.clientWidth};});
            assert.ok(geometry.top>=0 && geometry.bottom<=viewport.height && geometry.left>=0 && geometry.right<=viewport.width,JSON.stringify({viewport,size,geometry}));
            assert.ok(geometry.horizontal<=1,JSON.stringify({viewport,size,geometry}));
          }
          const primary=modal.getByRole('button',{name:'Restore',exact:true});
          const secondary=modal.getByRole('button',{name:"Keep the link's game",exact:true});
          await primary.focus(); await page.keyboard.press('Shift+Tab');
          assert.equal(await modal.getByRole('button',{name:'Decide later'}).evaluate(el=>el===document.activeElement),true);
          await page.keyboard.press('Tab');
          assert.equal(await primary.evaluate(el=>el===document.activeElement),true);
          const chosen=restore?primary:secondary;
          await chosen.scrollIntoViewIfNeeded();
          const button=await chosen.boundingBox();
          assert.ok(button.y>=0 && button.y+button.height<=viewport.height && button.height>=44);
          if(restore) await page.screenshot({path:`/tmp/xiangqi-recovery-text-${browserType.name()}-${viewport.width}.png`});
          await chosen.click(); await modal.waitFor({state:'hidden'});
          // The chosen red cannon lands on e2; its original square distinguishes
          // restoring the old game from keeping the followed link.
          const occupiedFile=restore?1:7;
          await page.waitForFunction(file=>document.querySelector(`.hitbox[data-file="${file}"][data-rank="2"]`)?.getAttribute('aria-label')?.includes('cannon'),occupiedFile);
          assert.deepEqual(errors,[]);
          console.log(`${browserType.name()} ${viewport.width}x${viewport.height}: 100/150/200% text, bounded scrolling, focus trap and ${restore?'Restore':'Keep link'} passed`);
        } finally {await page.close();}
      }
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
