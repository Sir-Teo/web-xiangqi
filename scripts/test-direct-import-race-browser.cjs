const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function dropFiles(page, files) {
  const transfer = await page.evaluateHandle(files => {
    const data = new DataTransfer();
    for (const file of files) data.items.add(new File([file.bytes ? Uint8Array.from(file.bytes) : file.text], file.name, { type: file.mimeType || 'text/plain' }));
    return data;
  }, files);
  try {
    const field = page.getByTestId('uci-line-input');
    await field.scrollIntoViewIfNeeded();
    await field.dispatchEvent('dragover', { dataTransfer: transfer });
    await field.dispatchEvent('drop', { dataTransfer: transfer });
  } finally { await transfer.dispose(); }
}

function xqfFile() {
  const header = Buffer.alloc(1024); header.write('XQ'); header[2] = 10;
  header.set([80,70,60,50,40,30,20,10,0,72,12,83,63,43,23,3,9,19,29,39,49,59,69,79,89,17,77,6,26,46,66,86], 16);
  const root = Buffer.alloc(8); root[0] = 24; root[1] = 32; root[2] = 0xf0;
  const move = Buffer.alloc(8); move[0] = 96; move[1] = 74;
  return Array.from(Buffer.concat([header, root, move]));
}

async function checkDrops(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedPgn = text; } } });
      const read = File.prototype.arrayBuffer; window.readFiles = [];
      File.prototype.arrayBuffer = function() {
        window.readFiles.push(this.name);
        if (this.name !== 'slow.pgn') return read.call(this);
        return new Promise(resolve => { window.releaseSlowFile = () => read.call(this).then(resolve); });
      };
    });
    const redCannon = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1';
    await page.goto(base + '?moves=h2e2');
    await page.waitForFunction(fen => document.querySelector('.bottombar-fen')?.title === fen, redCannon);
    const library = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
    const open = async () => {
      if (width < 900) await page.getByTestId('mobile-view-board').click();
      await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
    };
    const copy = async () => {
      await page.evaluate(() => { window.copiedPgn = ''; });
      await page.keyboard.press('ControlOrMeta+k'); await page.getByRole('combobox').fill('Copy PGN'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => Boolean(window.copiedPgn));
      return page.evaluate(() => window.copiedPgn);
    };
    await open();
    await page.evaluate(async () => { document.documentElement.style.fontSize = '32px'; await document.fonts.ready; });
    const field = page.getByTestId('uci-line-input');
    await field.fill('b0c2');
    await dropFiles(page, [{ name: 'one.pgn', text: 'h2e2' }, { name: 'two.pgn', text: 'b2e2' }]);
    assert.match(await page.locator('#new-game-line-error').innerText(), /one game file/);
    assert.equal(await field.inputValue(), 'b0c2', 'Rejected drops must preserve the current draft');
    await dropFiles(page, [{ name: 'large.pgn', text: 'x'.repeat(200001) }]);
    assert.match(await page.locator('#new-game-line-error').innerText(), /too large/);
    assert.equal(await page.evaluate(() => window.readFiles.includes('large.pgn') || window.readFiles.includes('one.pgn')), false, 'Rejected files must not be read');
    await dropFiles(page, [{ name: 'slow.pgn', text: 'h2e2' }]);
    await page.getByRole('button', { name: 'Cancel reading', exact: true }).click();
    assert.equal(await field.evaluate(node => node === document.activeElement), true, 'Canceling a dropped file must restore the move box');
    await page.evaluate(() => window.releaseSlowFile()); await page.waitForTimeout(100);
    assert.equal(await field.inputValue(), '');
    assert.equal(await page.locator('#new-game-line-error').count(), 0);
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon);
    assert.equal(await field.evaluate(node => {
      const data = new DataTransfer(); data.setData('text/plain', 'h2e2');
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
      node.dispatchEvent(event); return event.defaultPrevented;
    }), false, 'Plain text drops keep the browser editing behavior');
    const source = '[Event "Dropped record"]\n1. b2e2 *';
    await dropFiles(page, [{ name: 'record.pgn', text: source }]);
    await page.waitForFunction(source => document.getElementById('new-game-line-input')?.value === source, source);
    assert.equal(await field.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('.new-game-menu').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await field.screenshot({ path: `/tmp/xiangqi-file-drop-${browserType.name()}-${width}.png` });
    await page.getByTestId('import-uci-line-btn').click(); await field.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon.replace('1C2C4', '4C2C1'));
    assert.ok((await copy()).includes('[Event "Dropped record"]'));
    await open(); await dropFiles(page, [{ name: 'position.xqf', bytes: xqfFile(), mimeType: 'application/octet-stream' }]);
    await field.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon, 'A dropped XQF must load through the binary reader');
    assert.ok(!(await copy()).includes('Dropped record'), 'A binary drop must clear the previous record metadata');
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), library);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()} ${width}px: PGN/XQF drops, read cancellation, focus, multiple/oversized rejection, plain text and enlarged import layout passed`);
  } finally { await page.close(); }
}

(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      const read = File.prototype.arrayBuffer;
      window.pendingFiles = {};
      File.prototype.arrayBuffer = function() {
        return new Promise((resolve, reject) => { window.pendingFiles[this.name] = fail => fail ? reject(new Error('Old failure')) : read.call(this).then(resolve); });
      };
    });
    await page.goto(base);
    const open = () => page.getByRole('button', { name: 'Start new game', exact: true }).click();
    await open();
    const file = name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name === 'new.pgn' ? 'b2e2' : 'h2e2') });
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(file('old.pgn'));
    await dropFiles(page, [{ name: 'new.pgn', text: 'b2e2' }]);
    await page.evaluate(() => window.pendingFiles['new.pgn']());
    await page.waitForFunction(() => document.querySelector('#new-game-line-input').value === 'b2e2');
    await page.evaluate(() => window.pendingFiles['old.pgn']());
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('uci-line-input').inputValue(), 'b2e2');
    await dropFiles(page, [{ name: 'closing.pgn', text: 'h2e2' }]);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.pendingFiles['closing.pgn'](true));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#new-game-line-error').count(), 0);
    await open();
    assert.equal(await page.getByTestId('uci-line-input').inputValue(), '');
    assert.equal(await page.locator('#new-game-line-error').count(), 0);
    await dropFiles(page, [{ name: 'typing.pgn', text: 'h2e2' }]);
    await page.getByTestId('uci-line-input').fill('b0c2');
    await page.evaluate(() => window.pendingFiles['typing.pgn']());
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('uci-line-input').inputValue(), 'b0c2');
    await page.close();
    console.log('PASS: stale file success/failure cannot overwrite a newer file, a closed dialog, or typed input');
    for (const width of [1440, 390, 320]) await checkDrops(browser, width);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
