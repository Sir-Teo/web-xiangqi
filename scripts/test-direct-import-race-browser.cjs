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
        if (this.name === 'unreadable.pgn') return Promise.reject(new DOMException('The file could not be read.', 'NotReadableError'));
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
    const undo = page.getByRole('button', { name: 'Undo file load', exact: true });
    const pick = async (name, text) => {
      await page.getByTestId('uci-line-file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
      await page.waitForFunction(({ name, text }) => document.getElementById('new-game-line-input')?.value === text
        && document.querySelector('.new-game-file-name')?.getAttribute('title') === name
        && !document.querySelector('[data-testid="import-uci-line-btn"]:disabled'), { name, text });
    };
    const restore = async (shortcut = 'Enter', control = undo) => {
      await control.scrollIntoViewIfNeeded(); await control.focus(); await page.keyboard.press(shortcut);
      await page.waitForFunction(() => document.activeElement?.id === 'new-game-line-input');
      assert.equal(await undo.count(), 0);
    };
    await field.fill('b0c2');
    await dropFiles(page, [{ name: 'one.pgn', text: 'h2e2' }, { name: 'two.pgn', text: 'b2e2' }]);
    assert.match(await page.locator('#new-game-line-error').innerText(), /one game file/);
    assert.equal(await field.inputValue(), 'b0c2', 'Rejected drops must preserve the current draft');
    await dropFiles(page, [{ name: 'large.pgn', text: 'x'.repeat(200001) }]);
    assert.match(await page.locator('#new-game-line-error').innerText(), /too large/);
    assert.equal(await field.inputValue(), 'b0c2', 'Oversized files must preserve the current draft');
    assert.equal(await page.evaluate(() => window.readFiles.includes('large.pgn') || window.readFiles.includes('one.pgn')), false, 'Rejected files must not be read');
    for (const [name, text] of [['empty.pgn', ''], ['whitespace.pgn', ' \n\t '], ['bom.pgn', '\uFEFF']]) {
      for (const method of ['picker', 'drop']) {
        if (method === 'picker') await page.getByTestId('uci-line-file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
        else await dropFiles(page, [{ name, text }]);
        await page.waitForFunction(() => /empty/i.test(document.getElementById('new-game-line-error')?.textContent || '') && !document.querySelector('.new-game-line-actions button:disabled'));
        assert.equal(await field.inputValue(), 'b0c2', `${method}: ${name} must preserve the current draft`);
        assert.equal(await field.getAttribute('aria-invalid'), 'true');
        assert.equal(await page.locator('.new-game-file-name').count(), 0);
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon);
      }
    }
    await dropFiles(page, [{ name: 'slow.pgn', text: 'h2e2' }]);
    await page.getByRole('button', { name: 'Cancel reading', exact: true }).click();
    assert.equal(await field.evaluate(node => node === document.activeElement), true, 'Canceling a dropped file must restore the move box');
    await page.evaluate(() => window.releaseSlowFile()); await page.waitForTimeout(100);
    assert.equal(await field.inputValue(), 'b0c2');
    assert.equal(await page.locator('#new-game-line-error').count(), 0);
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon);
    assert.equal(await field.evaluate(node => {
      const data = new DataTransfer(); data.setData('text/plain', 'h2e2');
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
      node.dispatchEvent(event); return event.defaultPrevented;
    }), false, 'Plain text drops keep the browser editing behavior');
    await pick('preview.pgn', 'b2e2');
    await pick('preview.pgn', 'b2e2');
    for (const [name, text, message] of [
      ['rejected-empty.pgn', '', 'The file is empty'],
      ['rejected-large.pgn', 'x'.repeat(200001), 'File is too large'],
      ['unreadable.pgn', 'h2e2', /could not.*read/i],
    ]) {
      await dropFiles(page, [{ name, text }]);
      await page.getByRole('alert').filter({ hasText: message }).waitFor();
      assert.equal(await field.inputValue(), 'b2e2', 'Rejected replacements retain the current preview');
      assert.equal(await page.locator('.new-game-file-name').getAttribute('title'), 'preview.pgn', 'Rejected replacements retain the preview filename');
      assert.equal(await undo.count(), 1, 'Rejected replacements preserve the earlier Undo');
    }
    assert.equal(await page.evaluate(() => window.readFiles.includes('rejected-large.pgn')), false);
    const emptyXqf = xqfFile().slice(0, 1032); emptyXqf[1026] = 0;
    await dropFiles(page, [{ name: 'empty.xqf', bytes: emptyXqf }]);
    await page.getByRole('alert').filter({ hasText: 'This XQF file holds no moves and no position' }).waitFor();
    assert.equal(await field.inputValue(), 'b2e2');
    assert.equal(await page.locator('.new-game-file-name').getAttribute('title'), 'preview.pgn', 'Rejected binary files must not rename the text preview');
    assert.equal(await undo.count(), 1);
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon);
    await restore('Control+z', page.getByTestId('load-uci-file-btn'));
    assert.equal(await field.inputValue(), 'b0c2', 'Repeated identical file reads must retain the original draft for Undo');
    assert.equal(await page.locator('.new-game-file-name').count(), 0);
    await pick('first.pgn', 'b2e2');
    const untouched = await field.evaluate(node => [
      { ctrlKey: true, shiftKey: true }, { ctrlKey: true, isComposing: true }, { metaKey: true, keyCode: 229 },
    ].map(flags => {
      node.focus(); const event = new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true, ...flags });
      node.dispatchEvent(event); return event.defaultPrevented;
    }));
    assert.deepEqual(untouched, [false, false, false], 'Redo and composing keys keep their native behavior');
    assert.equal(await field.inputValue(), 'b2e2'); assert.equal(await undo.count(), 1);
    await dropFiles(page, [{ name: 'second.pgn', text: 'h2e2' }]);
    await page.waitForFunction(() => document.querySelector('.new-game-file-name')?.title === 'second.pgn');
    await restore('Meta+z', field);
    assert.equal(await field.inputValue(), 'b2e2');
    assert.equal(await page.locator('.new-game-file-name').getAttribute('title'), 'first.pgn', 'Undo restores the previous filename too');
    await field.fill('b0c2');
    await pick('pending.pgn', 'b2e2');
    await dropFiles(page, [{ name: 'slow.pgn', text: 'h2e2' }]);
    await restore();
    await page.evaluate(() => window.releaseSlowFile()); await page.waitForTimeout(100);
    assert.equal(await field.inputValue(), 'b0c2', 'Undo cancels an in-flight replacement and ignores its late reply');
    assert.equal(await page.getByRole('button', { name: 'Cancel reading', exact: true }).count(), 0);
    const source = '[Event "Dropped record"]\n1. b2e2 *';
    await dropFiles(page, [{ name: 'record.pgn', text: source }]);
    await page.waitForFunction(source => document.getElementById('new-game-line-input')?.value === source, source);
    await restore(); assert.equal(await field.inputValue(), 'b0c2');
    await dropFiles(page, [{ name: 'record.pgn', text: source }]);
    await page.waitForFunction(source => document.getElementById('new-game-line-input')?.value === source, source);
    assert.equal(await field.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.locator('.new-game-menu').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await undo.scrollIntoViewIfNeeded();
    const undoBox = await undo.boundingBox();
    assert.ok(undoBox.height >= 44 && undoBox.x >= 0 && undoBox.x + undoBox.width <= width, 'Undo must remain a readable touch target');
    await page.locator('.new-game-file-row').screenshot({ path: `/tmp/xiangqi-file-undo-${browserType.name()}-${width}.png` });
    await field.screenshot({ path: `/tmp/xiangqi-file-drop-${browserType.name()}-${width}.png` });
    await page.getByTestId('import-uci-line-btn').click(); await field.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon.replace('1C2C4', '4C2C1'));
    assert.ok((await copy()).includes('[Event "Dropped record"]'));
    await open();
    assert.equal(await undo.count(), 0, 'A new dialog must not retain the previous file Undo');
    await pick('edited.txt', 'b2e2');
    await field.fill('h0g2');
    assert.equal(await undo.count(), 0, 'Typing a new draft expires file Undo');
    await dropFiles(page, [{ name: 'position.xqf', bytes: xqfFile(), mimeType: 'application/octet-stream' }]);
    await field.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), redCannon, 'A dropped XQF must load through the binary reader');
    assert.ok(!(await copy()).includes('Dropped record'), 'A binary drop must clear the previous record metadata');
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), library);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()} ${width}px: PGN/XQF drops, file Undo, Ctrl/Cmd+Z, IME/redo ownership, pending-read cancellation, rejected-preview preservation, focus and enlarged layout passed`);
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
    await page.getByRole('button', { name: 'Undo file load', exact: true }).click();
    assert.equal(await page.getByTestId('uci-line-input').inputValue(), '', 'Undo must also restore an empty original draft');
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
