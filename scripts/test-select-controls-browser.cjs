const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
async function command(page, text) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(text);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function measure(page, target, label, width) {
  await target.first().waitFor();
  for (const fontSize of [16, 32, 16]) {
    await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, fontSize);
    for (const field of await target.all()) {
      await field.scrollIntoViewIfNeeded();
      await page.keyboard.press(browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
      await field.focus();
      const info = await field.evaluate(el => {
        const style = getComputedStyle(el); const box = el.getBoundingClientRect();
        const panel = el.closest('[role="dialog"], .lib-panel, .candidate-panel, .review-panel');
        return { name: el.getAttribute('aria-label') || el.id || el.closest('label')?.textContent.slice(0,30),
          height: box.height, font: parseFloat(style.fontSize), appearance: style.appearance,
          coarse: matchMedia('(pointer: coarse)').matches,
          outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth),
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          panelOverflow: panel && panel.scrollWidth > panel.clientWidth + 1 };
      });
      const minimum = info.coarse || ['lessons', 'study practice'].includes(label) ? 44 : 32;
      assert.ok(info.height >= minimum - .05, `${label}/${width}/${fontSize}: ${JSON.stringify(info)}`);
      assert.ok(info.outline !== 'none' && info.outlineWidth >= 2, `No keyboard focus outline: ${JSON.stringify(info)}`);
      assert.equal(info.pageOverflow, false, `${label} page overflow at ${width}/${fontSize}`);
      if (info.panelOverflow) {
        console.log(await field.evaluate(el => [...el.closest('.candidate-panel, .review-panel, .lib-panel, [role=dialog]').querySelectorAll('*')].filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => ({ tag:node.tagName, class:node.className, text:node.textContent.slice(0,100), width:node.clientWidth, scroll:node.scrollWidth }))));
        await page.screenshot({path: `/tmp/xiangqi-select-overflow-${browserType.name()}-${width}.png`});
      }
      assert.equal(Boolean(info.panelOverflow), false, `${label} panel overflow at ${width}/${fontSize}`);
      if (minimum === 44) assert.ok(info.font >= 16);
    }
    if (fontSize === 32) await page.screenshot({ path: `/tmp/xiangqi-select-${label.replaceAll(' ', '-')}-${browserType.name()}-${width}.png` });
  }
  console.log(`${browserType.name()} ${width}px: ${label} native controls, touch sizing, keyboard focus and enlarged-text reflow passed`);
}
(async () => {
 const browser = await browserType.launch();
 try {
  for (const [width, height] of [[1440,900],[390,844],[320,480],[844,390]]) {
   const page = await browser.newPage({viewport:{width,height},hasTouch:width<900,reducedMotion:"reduce"});
   const errors=[]; page.on('pageerror', error=>errors.push(error.message));
   try {
    await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([{id:'practice',savedAt:1,gameMode:'PvP',moves:['h2e2','h9g7'],label:'Practice fixture'}])));
    await page.route('**/pikafish.js', route => route.fulfill({contentType:'application/javascript',body:`
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners=[]; const emit = line => listeners.forEach(f => f(line)); let position='';
        return {variant:'single-simd',addMessageListener: f=>listeners.push(f),terminate(){},postMessage(command){
          if(command.startsWith('position ')) position=command;
          if(command==='uci') queueMicrotask(()=>emit('uciok'));
          if(command==='isready') queueMicrotask(()=>emit('readyok'));
          if(command.startsWith('go ')) queueMicrotask(()=>{
            const afterBoth=position.includes('h2e2 h9g7'); const afterOne=position.includes('h2e2');
            const move=afterBoth?'h0g2':afterOne?'b9c7':'b2e2'; const score=afterBoth?-500:500;
            emit('info depth 12 score cp '+score+' pv '+move); emit('bestmove '+move);
          });
          if(command==='stop') queueMicrotask(()=>emit('bestmove (none)'));
        }};
      };` }));
    await page.goto(base); await page.locator('.xiangqi-board').waitFor();
    await command(page,'Learn the rules');
    await measure(page,page.getByTestId('lesson-select'),'lessons',width);
    await page.getByTestId('lesson-select').selectOption('1');
    const lessonTitle = (await page.getByTestId('lesson-select').locator('option:checked').innerText()).replace(/^\d+\. /, '');
    await page.getByRole('heading', { name: lessonTitle, exact:true }).waitFor();
    await page.getByRole('button',{name:'Close rule lessons',exact:true}).click();
    await command(page,'Settings');
    await measure(page,page.locator('.premium-select'),'settings',width);
    await page.locator('#settings-workspace-mode').selectOption('play');
    assert.equal(await page.locator('#settings-workspace-mode').inputValue(),'play');
    await page.locator('#settings-workspace-mode').selectOption('analysis');
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await command(page,'Library');
    await measure(page,page.locator('.lib-filter-select'),'library',width);
    await page.getByRole('combobox',{name:'Filter by result',exact:true}).selectOption('ongoing');
    await page.getByRole('combobox',{name:'Sort saved games',exact:true}).selectOption('oldest');
    await page.getByTestId('practice-saved-practice').click();
    await measure(page,page.getByRole('combobox',{name:'Practice as'}),'study practice',width);
    await page.getByRole('combobox',{name:'Practice as'}).selectOption('b');
    assert.equal(await page.getByRole('combobox',{name:'Practice as'}).inputValue(),'b');
    await page.getByRole('button',{name:'Close study practice',exact:true}).click();
    await command(page,'Compare candidate moves');
    await page.locator('#candidate-move').selectOption('h2e2');
    assert.equal(await page.locator('#candidate-choice-description').innerText(), await page.locator('#candidate-move option:checked').innerText());
    await measure(page,page.locator('#candidate-move'),'candidate comparison',width);
    await page.getByRole('button',{name:'Add move',exact:true}).click();
    await page.getByRole('button',{name:'Remove candidate h2e2',exact:true}).waitFor();
    await command(page,'Move tree');
    if(width<900) await page.getByTestId('mobile-view-board').click();
    await page.getByRole('button',{name:width<900?'Open new game menu':'Start new game',exact:true}).click();
    await page.getByTestId('uci-line-input').fill('h2e2 h9g7'); await page.getByTestId('import-uci-line-btn').click();
    await page.getByTestId('uci-line-input').waitFor({state:'hidden'});
    await page.keyboard.press('r'); await page.locator('.review-panel [data-testid="start-review-btn"]').click();
    await measure(page,page.locator('.review-moment-filter'),'review filters',width);
    await page.getByTestId('review-moment-side-filter').selectOption('red');
    assert.equal(await page.getByTestId('review-moment-side-filter').inputValue(),'red');
    assert.deepEqual(errors,[]);
   } finally {await page.close();}
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
