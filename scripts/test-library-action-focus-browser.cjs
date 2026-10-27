const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5200/web-xiangqi/';
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 480], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'a', savedAt: 3, gameMode: 'PvP', label: 'Study A', moves: ['h2e2'], metadata: { event: 'First event' } },
          { id: 'b', savedAt: 2, gameMode: 'PvP', label: 'Position study B', moves: [], rootComment: 'Opening plan before choosing a move.' },
          { id: 'c', savedAt: 1, gameMode: 'PvP', label: 'Study C', moves: ['b2e2'], metadata: { event: 'Third event' } },
        ])));
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
        await page.goto(base); await page.locator('.xiangqi-board').waitFor(); await command(page, 'Library');
        const action = (name, id) => page.getByTestId(`${name}-saved-${id}`);
        const card = id => page.locator(`.lib-card[data-game-id="${id}"]`);
        const details = id => card(id).getByRole('button', { name: `Game details for Study ${id.toUpperCase()}`, exact: true });
        const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        const moveFocus = async (from, key, to) => {
          await from.focus(); await page.keyboard.press(key); await settle(page);
          const actual = await page.evaluate(() => document.activeElement?.outerHTML);
          assert.equal(await to.evaluate(node => node === document.activeElement), true, `${key} must preserve the action or use Load; got ${actual}`);
          const reach = await to.evaluate(node => {
            const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { reachable: node.contains(hit), rect: r.toJSON(), hit: hit?.outerHTML.slice(0, 160) };
          });
          if (!reach.reachable) await page.screenshot({ path: '/tmp/xiangqi-library-action-focus-failure.png' });
          assert.equal(reach.reachable, true, `The destination control must be reachable (${key}): ${JSON.stringify(reach)}`);
          assert.equal(await to.getAttribute('tabindex'), '0');
          const stops = await page.locator('.lib-card[data-game-id]').evaluateAll(cards => cards.filter(card => card.querySelector('button[tabindex="0"]')).length);
          assert.equal(stops, 1, 'Only the active card belongs in the tab order');
        };
        for (const flags of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
          const load = action('load', 'c'); await load.focus();
          const state = await load.evaluate((node, flags) => {
            const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true, ...flags });
            if (flags.prePrevented) event.preventDefault();
            node.dispatchEvent(event);
            return { prevented: event.defaultPrevented, retained: document.activeElement === node };
          }, flags);
          assert.deepEqual(state, { prevented: !!flags.prePrevented, retained: true }, `Modified/composing/claimed Home must preserve the library action: ${JSON.stringify(flags)}`);
        }
        await moveFocus(action('practice', 'a'), 'ArrowDown', action('load', 'b'));
        await moveFocus(action('delete', 'a'), 'ArrowDown', action('delete', 'b'));
        await moveFocus(action('delete', 'b'), 'ArrowUp', action('delete', 'a'));
        await card('a').locator('.lib-game-name-button').click();
        await moveFocus(action('copy-pgn', 'a'), 'End', action('copy-pgn', 'c'));
        await moveFocus(action('download-pgn', 'c'), 'Home', action('download-pgn', 'a'));
        await moveFocus(action('cancel-rename', 'a'), 'End', action('load', 'c'));
        await action('cancel-rename', 'a').click();
        await action('delete', 'a').click();
        await moveFocus(action('confirm-delete', 'a'), 'End', action('load', 'c'));
        await moveFocus(action('cancel-delete', 'a'), 'ArrowDown', action('load', 'b'));
        await moveFocus(action('delete', 'b'), 'ArrowUp', action('load', 'a'));
        await action('cancel-delete', 'a').click();
        await action('load', 'a').click(); await command(page, 'Library');
        await action('update', 'a').waitFor();
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size); await settle(page);
          await moveFocus(details('c'), 'Home', details('a'));
          await page.keyboard.press('Enter'); await settle(page);
          assert.equal(await details('a').getAttribute('aria-expanded'), 'true');
          await page.keyboard.press('Enter'); await settle(page);
          await moveFocus(details('a'), 'End', details('c'));
          if (await action('update', 'a').isEnabled()) await moveFocus(action('update', 'a'), 'End', action('load', 'c'));
          await moveFocus(action('practice', 'c'), 'ArrowUp', action('load', 'b'));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          await page.screenshot({ path: `/tmp/xiangqi-library-action-focus-${browserType.name()}-${width}-${size}.png` });
        }
        assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:library:v1')), before, 'Navigation must not rename, delete or update studies');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}x${height}: action-preserving arrows/Home/End, absent actions, rename/delete controls, open-study update, metadata disclosure and enlarged-text focus passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
