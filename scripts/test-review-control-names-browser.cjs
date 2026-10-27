const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const moves = ['h2e2', 'h9g7', 'b0c2', 'b9c7', 'a0b0', 'a9b9'];
const fixture = { id: 'review-voice', savedAt: 1, gameMode: 'PvP', moves, label: 'Voice review',
  review: { summary: { totalMoves: 6, accuracy: 80, redAccuracy: 70, blackAccuracy: 90, averageCentipawnLoss: 40,
    bestCount: 4, goodCount: 0, inaccuracyCount: 0, mistakeCount: 2, blunderCount: 0, reviewedAt: 1,
    lineSignature: moves.join(' '), keyMoments: [{ nodeId: 'n3', moveIndex: 2, jumpTarget: 2, ply: 3, side: 'red', quality: 'mistake',
      swing: 240, winPercentLoss: 20.7, evalBefore: 0, evalAfter: -240, bestMove: 'h0g2', playedMove: 'b0c2', note: 'Missed a stronger continuation.' },
      { nodeId: 'n5', moveIndex: 4, jumpTarget: 4, ply: 5, side: 'red', quality: 'mistake',
        swing: 240, winPercentLoss: 20.7, evalBefore: -240, evalAfter: -480, bestMove: 'h0g2', playedMove: 'a0b0', note: 'Missed a stronger continuation.' }] },
    annotations: moves.map((_, moveIndex) => ({ moveIndex, evalScore: moveIndex >= 4 ? -480 : moveIndex >= 2 ? -240 : 0, quality: [2, 4].includes(moveIndex) ? 'mistake' : 'best',
      swing: [2, 4].includes(moveIndex) ? 240 : 0, winPercentLoss: [2, 4].includes(moveIndex) ? 20.7 : 0,
      ...([2, 4].includes(moveIndex) ? { bestMove: 'h0g2', reviewNote: 'Missed a stronger continuation.' } : {}) })) } };
async function command(page, name) {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: 'Search commands' });
  await input.fill(name); await page.keyboard.press('Enter'); await input.waitFor({ state: 'hidden' });
}
async function namedByCaption(scope, testId) {
  const control = scope.getByTestId(testId);
  const caption = (await control.innerText()).replace(/\s+/g, ' ').trim();
  const named = scope.getByRole('button', { name: new RegExp('^' + escapeRegex(caption), 'i') });
  await named.waitFor();
  assert.equal(await named.getAttribute('data-testid'), testId, `The visible caption must address ${testId}`);
  return named;
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900 });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(fixture => localStorage.setItem('xiangqi:library:v1', JSON.stringify([fixture])), fixture);
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ') || command === 'stop') queueMicrotask(() => emit('bestmove (none)'));
            } };
          };` }));
        await page.goto(base); await page.locator('.xiangqi-board').first().waitFor();
        await command(page, 'Library'); await page.getByTestId('load-saved-review-voice').click();
        await command(page, 'Engine panel');
        await page.waitForFunction(() => document.querySelector('.top-engine-state')?.textContent.includes('Engine ready'));
        await command(page, 'Review panel');
        const savedBeforePractice = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const moments = page.locator('.review-moment-card');
        assert.equal(await moments.count(), 2, 'Both reviewed mistakes must remain available');
        const currentFen = await page.locator('.bottombar-fen').getAttribute('title');
        for (const flags of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
          await moments.last().focus();
          const state = await moments.last().evaluate((node, flags) => {
            const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true, ...flags });
            if (flags.prePrevented) event.preventDefault();
            node.dispatchEvent(event);
            return { prevented: event.defaultPrevented, retained: document.activeElement === node };
          }, flags);
          assert.deepEqual(state, { prevented: !!flags.prePrevented, retained: true }, `Modified/composing/claimed Home must preserve review focus: ${JSON.stringify(flags)}`);
        }
        await page.keyboard.press('Home');
        assert.equal(await moments.first().evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('ArrowDown');
        assert.equal(await moments.last().evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), currentFen, 'Roving review focus must preserve the board');
        for (const notation of ['wxf', 'chinese', 'uci']) {
          if (notation !== 'wxf') await command(page, notation === 'chinese' ? 'Write moves in Chinese (中文)' : 'Write moves in coordinates (UCI)');
          const moment = page.getByTestId('review-moment-2');
          const played = await moment.locator('.review-moment-main > span').innerText();
          const quality = await moment.locator('.review-moment-topline > span').innerText();
          const note = await moment.locator('p').innerText();
          const best = await moment.locator(':scope > em').first().innerText();
          const namedMoment = page.getByRole('button', { name: new RegExp('^' + escapeRegex(quality) + '.*\\bply\\s+3\\b.*' + escapeRegex(played) + '.*' + escapeRegex(note) + '.*' + escapeRegex(best), 'i') });
          assert.equal(await namedMoment.getAttribute('data-testid'), 'review-moment-2', 'The move name must include its visible move, note and best continuation');
          const explanations = await moment.locator('.review-moment-eval, .review-chance-loss').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
          assert.equal(explanations.length, 2);
          assert.match(explanations[0], /evaluation changed/i);
          assert.match(explanations[1], /advantage indicator dropped/i);
          if (browserType.name() === 'chromium' && width === 1440 && notation === 'wxf') {
            const session = await page.context().newCDPSession(page);
            try {
              const { root } = await session.send('DOM.getDocument');
              const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-testid="review-moment-2"]' });
              const { nodes } = await session.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
              const reading = nodes.find(node => node.role?.value === 'button');
              for (const explanation of explanations) assert.ok(reading.name?.value.includes(explanation), 'Score explanations must reach the browser accessibility tree');
            } finally { await session.detach(); }
          }
          const entry = moment.locator('..');
          await namedByCaption(entry, 'review-try-best-2');
          await namedByCaption(entry, 'review-practice-2');
          if (width >= 900) await namedByCaption(page, 'view-completed-review-btn');
        }
        const practice = await namedByCaption(page.locator('.review-moment-entry').first(), 'review-practice-2');
        await practice.focus(); await page.keyboard.press('Enter');
        await page.locator('.board-stage').waitFor({ state: 'visible' });
        const beforeMistake = 'rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w';
        await page.waitForFunction(fen => document.querySelector('.bottombar-fen')?.getAttribute('title')?.startsWith(fen + ' '), beforeMistake);
        await command(page, 'Settings');
        assert.equal(await page.getByLabel('Game Mode', { exact: true }).inputValue(), 'PvAI-Black', 'Practice must let Red play from before the reviewed mistake');
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), savedBeforePractice, 'Starting practice must preserve the saved review');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: review move names, score explanations, visible action captions and keyboard practice passed in all three notations`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-review-controls-${browserType.name()}-${width}.png` }).catch(() => {});
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
