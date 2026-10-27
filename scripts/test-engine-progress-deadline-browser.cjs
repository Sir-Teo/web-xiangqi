const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function appDownload(browser) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => { window.__WEB_XIANGQI_ENGINE_READY_TIMEOUT_MS = 400; });
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.__bootStarts = 0; window.__bootAborts = 0;
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = options => new Promise((resolve, reject) => {
        window.__bootStarts++;
        let loaded = 0;
        const progress = setInterval(() => options.onAssetProgress?.({loaded:loaded+=1048576,total:53719310,done:false}), 80);
        const finish = setTimeout(() => {
          clearInterval(progress);
          options.signal.removeEventListener('abort',cancelStartup);
          options.onAssetProgress?.({loaded:53719310,total:53719310,done:true});
          const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
          resolve({variant:'single-simd',terminate(){listeners.length=0},addMessageListener: listener => listeners.push(listener),postMessage(command) {
            if(command==='uci')queueMicrotask(()=>emit('uciok'));
            if(command==='isready')queueMicrotask(()=>emit('readyok'));
            if(command.startsWith('go ')||command==='stop')queueMicrotask(()=>emit('bestmove (none)'));
          }});
        },1200);
        function cancelStartup() {
          window.__bootAborts++; clearInterval(progress); clearTimeout(finish);
          reject(new DOMException('Startup canceled','AbortError'));
        }
        options.signal.addEventListener('abort',cancelStartup,{once:true});
      });` }));
    await page.goto(base);
    await page.getByTestId('start-engine-analysis').click();
    await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'), null, {timeout:6000});
    // A timer armed by the last progress update must be canceled on success.
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__bootStarts), 1, 'An advancing download must not restart the engine');
    assert.equal(await page.evaluate(() => window.__bootAborts), 0);
    assert.match(await page.locator('.top-engine-state').innerText(), /Engine ready/);
  } catch (error) {
    console.error('App startup:', await page.evaluate(() => ({starts:window.__bootStarts,aborts:window.__bootAborts,status:document.querySelector('.top-engine-state')?.textContent})));
    throw error;
  } finally { await page.close(); }
}

async function wrapperDownload(browser) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      window.__terminations = 0;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker { terminate() { window.__terminations++; super.terminate(); } };
    });
    await page.route('**/qa-progress.html', route => route.fulfill({ contentType:'text/html', body:'<script src="./pikafish.js"></script>' }));
    await page.route('**/qa-progress-worker.js*', route => route.fulfill({ contentType:'application/javascript', body:`
      self.onmessage = event => {
        const data = event.data;
        if(data.type==='rpc')self.postMessage({type:'rpcResult',requestId:data.requestId,ok:true});
        if(data.type!=='init')return;
        const mode = new URL(self.location).searchParams.get('mode');
        let loaded=0;
        const progress = setInterval(() => {
          loaded = mode==='stalled' ? 1048576 : loaded+1048576;
          if(data.reportAssetProgress)self.postMessage({type:'assetProgress',loaded,total:53719310,done:false});
        },100);
        if(mode!=='stalled')setTimeout(()=>{clearInterval(progress);self.postMessage({type:'inited',variant:'single'});},2000);
      };` }));
    await page.goto(new URL('qa-progress.html', base).href);
    const create = (mode, extend, callback) => page.evaluate(async ({mode,extend,callback}) => {
      const before=window.__terminations;
      let messages=0;
      const result=await window.Pikafish.createWorkerEngine({variant:'single',
        workerScript:new URL('qa-progress-worker.js?mode='+mode,location.href).href,
        initTimeoutMs:800,...(extend === undefined ? {} : {extendInitTimeoutOnProgress:extend}),
        onAssetProgress:callback ? ()=>{messages++} : undefined,
      }).then(async engine=>{await engine.terminate();return {state:'ready'};},error=>({state:'error',message:error.message}));
      return {...result,messages,terminations:window.__terminations-before};
    }, {mode,extend,callback});
    const strict=await create('growing',undefined,true);
    assert.equal(strict.state,'error','The default API retains an absolute startup deadline');
    assert.match(strict.message,/Timed out/);
    assert.equal(strict.terminations,1);
    const advancing=await create('growing',true,false);
    assert.equal(advancing.state,'ready','Opted-in startup survives while downloaded bytes advance, even without a UI callback');
    assert.equal(advancing.terminations,1);
    const stalled=await create('stalled',true,true);
    assert.equal(stalled.state,'error','Repeating the same byte count must not keep startup alive');
    assert.match(stalled.message,/Timed out/);
    assert.ok(stalled.messages>1,'The stalled fixture must report repeated progress');
    assert.equal(stalled.terminations,1);
  } finally { await page.close(); }
}
(async()=>{
  const browser=await browserType.launch();
  try {
    await appDownload(browser);
    await wrapperDownload(browser);
    console.log(`${browserType.name()}: advancing startup, default hard deadline, duplicate-byte stall and worker cleanup passed`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
