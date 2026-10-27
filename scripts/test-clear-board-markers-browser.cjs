const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const clearLabel = 'Clear drawn arrows and highlights';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      try {
        await page.route('**/pikafish.js', route => route.fulfill({ contentType: 'application/javascript', body: `
          window.Pikafish = function() {};
          window.Pikafish.createWorkerEngine = async () => {
            const listeners = []; const emit = line => listeners.forEach(listener => listener(line));
            return { variant: 'single-simd', addMessageListener: listener => listeners.push(listener), terminate() {}, postMessage(command) {
              if (command === 'uci') queueMicrotask(() => emit('uciok'));
              if (command === 'isready') queueMicrotask(() => emit('readyok'));
              if (command.startsWith('go ')) queueMicrotask(() => emit('info depth 12 multipv 1 score cp 23 nodes 1000 nps 1000 pv h9g7'));
              if (command === 'stop') queueMicrotask(() => emit('bestmove h9g7'));
            } };
          };` }));
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        const initialFen = await page.locator('.bottombar-fen').getAttribute('title');
        await page.getByTestId('start-engine-analysis').click();
        await page.waitForFunction(() => document.querySelector('.board-arrow-engine'));
        if (width < 900) await page.getByTestId('mobile-view-board').click();
        const square = (file, rank) => page.locator(`.xiangqi-board .hitbox[data-file="${file}"][data-rank="${rank}"]`);
        const openCommand = async label => {
          await page.keyboard.press('ControlOrMeta+k');
          await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
          return page.getByRole('option', { name: label, exact: false });
        };
        const runCommand = async label => {
          const option = await openCommand(label);
          assert.equal(await option.isEnabled(), true, `${label} must be available`);
          if (width === 1440) await page.keyboard.press('Enter');
          else await option.click();
          await page.getByRole('dialog', { name: 'Commands', exact: true }).waitFor({ state: 'hidden' });
        };
        const checkEmptyCommand = async () => {
          const option = await openCommand(clearLabel);
          assert.equal(await option.isDisabled(), true, 'Clear must be disabled when no drawings remain');
          await page.keyboard.press('Enter');
          assert.equal(await page.getByRole('dialog', { name: 'Commands', exact: true }).isVisible(), true);
          await page.keyboard.press('Escape');
        };
        const drawArrow = async () => {
          const from = await square(4, 4).boundingBox();
          const to = await square(5, 5).boundingBox();
          await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
          await page.mouse.down({ button: 'right' });
          await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
          await page.mouse.up({ button: 'right' });
          await page.waitForFunction(() => document.querySelector('.board-arrow-user'));
        };
        const highlight = async () => {
          await square(0, 4).focus();
          await page.keyboard.press('Shift+Enter');
          assert.match(await square(0, 4).getAttribute('aria-label'), /highlighted/);
        };
        const preservedArrows = await page.locator('.board-arrow-group:not(.board-arrow-user)').evaluateAll(nodes => nodes.map(node => node.outerHTML));
        assert.ok(await page.locator('.board-arrow-engine').count() > 0);
        assert.ok(await page.locator('.board-arrow-last').count() > 0);
        await checkEmptyCommand();
        await drawArrow();
        await highlight();
        await runCommand(clearLabel);
        assert.equal(await page.locator('.board-arrow-user, .marker-highlight').count(), 0);
        assert.doesNotMatch(await square(0, 4).getAttribute('aria-label'), /highlighted/);
        assert.deepEqual(await page.locator('.board-arrow-group:not(.board-arrow-user)').evaluateAll(nodes => nodes.map(node => node.outerHTML)), preservedArrows,
          'Clearing drawings must preserve engine, last-move and book arrows');
        await checkEmptyCommand();
        // Each kind alone must enable Clear, including when hidden.
        for (const draw of [highlight, drawArrow]) {
          await draw();
          await runCommand('Hide arrows and markers');
          await runCommand(clearLabel);
          await runCommand('Show arrows and markers');
          assert.equal(await page.locator('.board-arrow-user, .marker-highlight').count(), 0, 'Hidden drawings must not return after clearing');
          await checkEmptyCommand();
        }
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), initialFen);
        console.log(`${browserType.name()} ${width}x${height}: visible/hidden arrows and highlights cleared; position and automatic arrows preserved; empty command disabled`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-clear-markers-${browserType.name()}-${width}.png` }).catch(() => {});
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
