const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.clock.install();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
        if (window.__copyDenied) throw new DOMException('Denied', 'NotAllowedError');
        if (window.__holdCopy) await new Promise((resolve, reject) => { window.__releaseCopy = resolve; window.__rejectCopy = reject; });
        window.__copiedText = text;
      } } });
      window.__fallbackCopies = [];
      document.execCommand = () => {
        if (!window.__allowFallbackCopy) return false;
        window.__copiedText = document.activeElement.value;
        window.__fallbackCopies.push(window.__copiedText); return true;
      };
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { if (window.__downloadDenied) throw new Error('Denied'); return create(blob); };
    });
    await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.Pikafish = function() {};
      window.Pikafish.createWorkerEngine = async () => {
        const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
        return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
          if (command === 'uci') queueMicrotask(() => emit('uciok'));
          if (command === 'isready') queueMicrotask(() => emit('readyok'));
          if (command.startsWith('go ')) queueMicrotask(() => {
            emit('info depth 18 multipv 1 score cp 25 pv h9g7 h0g2'); emit('bestmove h9g7');
          });
          if (command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
        } };
      };` }));
    await page.goto(base + '?moves=h2e2');
    await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
    const original = await page.evaluate(() => ({ fen: document.querySelector('.bottombar-fen').title, library: localStorage.getItem('xiangqi:library:v1') }));
    await page.keyboard.press('e'); await page.getByTestId('copy-engine-pv-0').waitFor();
    // Freeze the two-second success badges so this tests the state transitions,
    // independently of machine speed. DOM activation avoids paused-frame actionability.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const activate = button => button.evaluate(node => node.click());
    for (const id of ['copy-pgn-btn', 'copy-share-link-btn', 'copy-fen-btn', 'download-pgn-btn', 'copy-engine-pv-0', 'copy-record-btn']) {
      if (id === 'copy-record-btn') { await page.keyboard.press('t'); await page.getByTestId(id).waitFor(); }
      const button = page.getByTestId(id), download = id === 'download-pgn-btn';
      const success = download ? /Exported/ : /Copied/;
      await page.evaluate(() => { window.__copyDenied = false; window.__downloadDenied = false; });
      const firstFile = download ? page.waitForEvent('download') : null;
      await activate(button); if (firstFile) await firstFile;
      await button.filter({ hasText: success }).waitFor();
      if (!download) {
        await page.evaluate(() => { window.__holdCopy = true; }); await activate(button);
        await button.filter({ hasText: success }).waitFor({ state: 'hidden' });
        await page.evaluate(() => { window.__copyDenied = true; }); await activate(button);
        await button.filter({ hasText: /failed/i }).waitFor();
        await page.evaluate(() => { window.__copyDenied = false; window.__holdCopy = false; window.__releaseCopy(); });
        await page.clock.runFor(50);
        assert.match(await button.textContent(), /failed/i, `${id}: an older success must not replace a newer failure`);
        await activate(button);
        await button.filter({ hasText: success }).waitFor();
      }
      if (id === 'copy-pgn-btn') {
        await page.evaluate(() => { window.__holdCopy = true; }); await activate(button);
        await button.filter({ hasText: success }).waitFor({ state: 'hidden' });
        await page.evaluate(() => { window.__holdCopy = false; }); await activate(button);
        await button.filter({ hasText: success }).waitFor();
        await page.evaluate(() => window.__rejectCopy(new DOMException('Late denial', 'NotAllowedError')));
        await page.clock.runFor(50);
        assert.match(await button.textContent(), success, 'An older failure must not replace a newer successful copy');
      }
      await page.evaluate(download => { if (download) window.__downloadDenied = true; else window.__copyDenied = true; }, download);
      await activate(button); await button.filter({ hasText: /failed/i }).waitFor();
      await page.evaluate(() => { window.__copyDenied = false; window.__downloadDenied = false; });
      const other = page.getByTestId(id === 'copy-fen-btn' ? 'copy-pgn-btn' : 'copy-fen-btn');
      await activate(other); await other.filter({ hasText: /Copied/ }).waitFor();
      assert.doesNotMatch(await button.textContent(), /Copied|Exported/i, `${id}: another successful action must not revive the failed attempt's old badge`);
      assert.doesNotMatch(await button.getAttribute('aria-label'), /copied|exported/i, `${id}: the accessible name must not revive old success`);
      const retryFile = download ? page.waitForEvent('download') : null;
      await activate(button); if (retryFile) await retryFile;
      await button.filter({ hasText: success }).waitFor();
      assert.doesNotMatch(await button.getAttribute('class'), /warning/, 'Successful retries clear the failure style');
      console.log(`${browserType.name()} ${id}: success, failed retry, another action and successful retry retain accurate feedback`);
    }
    for (const id of ['copy-fen-btn', 'download-pgn-btn']) {
      const pending = page.getByTestId('copy-pgn-btn'), latest = page.getByTestId(id);
      await page.evaluate(() => { window.__holdCopy = true; }); await activate(pending);
      await pending.filter({ hasText: /Copied/ }).waitFor({ state: 'hidden' });
      await page.evaluate(id => { window.__copyDenied = id === 'copy-fen-btn'; window.__downloadDenied = id === 'download-pgn-btn'; }, id);
      await activate(latest); await latest.filter({ hasText: /failed/i }).waitFor();
      await page.evaluate(() => { window.__holdCopy = false; window.__copyDenied = false; window.__downloadDenied = false; window.__releaseCopy(); });
      await page.clock.runFor(50);
      assert.match(await latest.textContent(), /failed/i, 'An older clipboard reply cannot clear a newer action failure');
      assert.doesNotMatch(await pending.textContent(), /Copied/);
    }
    const pendingPgn = page.getByTestId('copy-pgn-btn'), currentFen = page.getByTestId('copy-fen-btn');
    await page.evaluate(() => { window.__holdCopy = true; window.__rejectCopy = undefined; });
    await activate(pendingPgn); await page.waitForFunction(() => typeof window.__rejectCopy === 'function');
    await page.evaluate(() => { window.__holdCopy = false; }); await activate(currentFen);
    await currentFen.filter({ hasText: /Copied/ }).waitFor();
    const newerText = await page.evaluate(() => window.__copiedText);
    await page.evaluate(() => { window.__allowFallbackCopy = true; window.__rejectCopy(new DOMException('Old denial', 'NotAllowedError')); });
    await page.clock.runFor(50);
    assert.equal(await page.evaluate(() => window.__copiedText), newerText, 'An older denied request must not overwrite newer clipboard text through the fallback');
    assert.equal(await page.evaluate(() => window.__fallbackCopies.length), 0, 'Superseded copies do not run the selection fallback');
    await page.evaluate(() => { window.__copyDenied = true; }); await activate(currentFen);
    await currentFen.filter({ hasText: /Copied/ }).waitFor();
    assert.equal(await page.evaluate(() => window.__copiedText), original.fen, 'The current request still supports the selection fallback');
    assert.equal(await page.evaluate(() => window.__fallbackCopies.length), 1);
    await page.evaluate(() => { window.__copyDenied = false; window.__allowFallbackCopy = false; });
    assert.deepEqual(await page.evaluate(() => ({ fen: document.querySelector('.bottombar-fen').title, library: localStorage.getItem('xiangqi:library:v1') })), original);
    await page.clock.resume();
    await page.evaluate(() => {
      localStorage.setItem('xiangqi:library:v1', JSON.stringify([
        { id: 'copy-a', label: 'Copy order A', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'] },
        { id: 'copy-b', label: 'Copy order B', savedAt: 2, gameMode: 'PvP', moves: ['b2e2'] },
        { id: 'load-invalid', label: 'Invalid saved path', savedAt: 3, gameMode: 'PvP', moves: ['a0a9'] },
      ]));
      dispatchEvent(new StorageEvent('storage', { key: 'xiangqi:library:v1', storageArea: localStorage }));
    });
    await page.getByTestId('left-panel-tab-library').click();
    const copyA = page.getByTestId('copy-pgn-saved-copy-a'), copyB = page.getByTestId('copy-pgn-saved-copy-b');
    await copyA.waitFor();
    const saved = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    for (const id of ['copy-pgn-saved-copy-a', 'copy-pgn-saved-copy-b', 'download-pgn-saved-copy-b', 'load-saved-load-invalid']) {
      await page.evaluate(() => { window.__holdCopy = true; window.__releaseCopy = undefined; });
      await activate(copyA); await page.waitForFunction(() => typeof window.__releaseCopy === 'function');
      await page.evaluate(id => { window.__copyDenied = id.startsWith('copy-'); window.__downloadDenied = id.startsWith('download-'); }, id);
      await activate(page.getByTestId(id));
      await page.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.classList.contains('chip-btn-warning'), id);
      await page.clock.runFor(50);
      const latestError = await page.getByTestId('library-action-error').textContent();
      await page.evaluate(() => { window.__holdCopy = false; window.__copyDenied = false; window.__downloadDenied = false; window.__releaseCopy(); });
      await page.clock.runFor(50);
      assert.equal(await page.getByTestId('library-action-error').textContent(), latestError, 'An older saved-game copy must preserve newer copy/download/load errors');
      assert.doesNotMatch(await copyA.textContent(), /Copied/);
    }
    await page.evaluate(() => { window.__holdCopy = true; window.__rejectCopy = undefined; });
    await activate(copyA); await page.waitForFunction(() => typeof window.__rejectCopy === 'function');
    await page.evaluate(() => { window.__holdCopy = false; });
    await activate(copyB); await copyB.filter({ hasText: /Copied/ }).waitFor();
    await page.evaluate(() => window.__rejectCopy(new DOMException('Late library denial', 'NotAllowedError')));
    await page.clock.runFor(50);
    assert.equal(await page.getByTestId('library-action-error').count(), 0, 'An older saved-game failure cannot replace a newer success');
    assert.match(await copyB.textContent(), /Copied/);
    assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), saved, 'Copy and failed-load feedback must preserve the library');
    assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), original.fen);
    console.log(`${browserType.name()}: saved-game copy replies preserve newer same-card, other-card, download and load feedback`);
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
