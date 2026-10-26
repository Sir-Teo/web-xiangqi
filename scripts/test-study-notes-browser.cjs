const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}
async function importPgn(page, width, source) {
  if (width < 900) await page.getByTestId('mobile-view-board').click();
  await page.getByRole('button', { name: width < 900 ? 'Open new game menu' : 'Start new game', exact: true }).click();
  await page.getByTestId('uci-line-input').fill(source);
  await page.getByTestId('import-uci-line-btn').click();
  await page.getByTestId('uci-line-input').waitFor({ state: 'hidden' });
}
async function noteIs(page, text) {
  await page.waitForFunction(text => document.getElementById('move-comment-input')?.value === text, text);
}
async function openFinder(page) {
  await command(page, 'Find study notes');
  await page.waitForFunction(() => document.activeElement?.id === 'study-notes-search');
}
async function assertFits(page) {
  const result = await page.getByTestId('study-notes').evaluate(details => ({
    documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
    overflow: [...details.querySelectorAll('input, ul, li, button, strong, small, span')].filter(element =>
      element.clientWidth && element.scrollWidth > element.clientWidth + 1).map(element => element.outerHTML.slice(0, 150)),
  }));
  assert.equal(result.documentFits, true);
  assert.deepEqual(result.overflow, []);
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 900, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
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
        await page.goto(base);
        await importPgn(page, width, '{Opening overview} h2e2 {Main cannon} (b2e2 {Side cannon 中炮 🐎} a9a8 {Side rook} (i9i8 {Nested rook}) h0g2 {Side horse}) h9g7 {Main horse} *');
        await openFinder(page);
        const search = page.locator('#study-notes-search');
        const results = page.locator('.study-note-result');
        assert.equal(await results.count(), 7);
        await search.fill('🐎 CANNON 中炮');
        assert.equal(await results.count(), 1);
        await page.keyboard.press(browserType.name() === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.className), 'study-note-result');
        await page.keyboard.press('Enter');
        await noteIs(page, 'Side cannon 中炮 🐎');
        assert.equal(await results.first().getAttribute('aria-current'), 'location');
        await search.fill('nested rook');
        await results.first().click();
        await noteIs(page, 'Nested rook');
        // Navigate before the 600ms draft timer; the edit must remain on its old node.
        await page.getByTestId('move-comment-input').fill('Nested rook edited immediately');
        await search.fill('overview');
        await results.first().click();
        await noteIs(page, 'Opening overview');
        await search.fill('edited immediately');
        await results.first().click();
        await noteIs(page, 'Nested rook edited immediately');
        await search.fill('no matching note');
        assert.equal(await results.count(), 0);
        await page.getByText('No notes match. Try fewer words.', { exact: true }).waitFor();
        await search.fill('');
        await search.focus();
        await page.screenshot({ path: `/tmp/xiangqi-study-notes-${browserType.name()}-${width}-natural.png` });
        for (const size of [32, 16]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await assertFits(page);
        }
        {
          const before = await page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
          await command(page, 'Save game');
          await page.waitForFunction(before => localStorage.getItem('xiangqi:library:v1') !== before, before);
        }
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1')).at(-1));
        assert.equal(saved.rootComment, 'Opening overview');
        assert.equal(saved.moveTree[1].children[1].comment, 'Nested rook edited immediately');
        // New game identity and reused IDs must clear the old filter and labels.
        await search.fill('edited');
        await importPgn(page, width, '[FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 42"]\n42... h9g7 {' + 'Q'.repeat(500) + '} *');
        await openFinder(page);
        assert.equal(await search.inputValue(), '');
        assert.equal(await results.count(), 1);
        assert.match(await results.first().innerText(), /42\.\.\./);
        await command(page, 'Write moves in Chinese');
        assert.match(await results.first().innerText(), /馬8進7/);
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.waitForFunction(size => parseFloat(getComputedStyle(document.querySelector('.study-note-result')).fontSize) === size * .8125, size);
          const style = await results.first().evaluate(element => ({ font: parseFloat(getComputedStyle(element).fontSize), align: getComputedStyle(element).alignItems }));
          assert.equal(style.font, size * .8125, 'Note previews must scale with reader text size');
          assert.equal(style.align, 'stretch', 'Panel button defaults must not center prose');
          await assertFits(page);
          await search.focus();
          await search.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/xiangqi-study-notes-${browserType.name()}-${width}-${size}.png` });
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
        if (width === 1440) {
          const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
          const branch = Array.from({ length: 1023 }, (_, index) => `${cycle[index % 4]} {Side note ${index + 1}}`).join(' ');
          await importPgn(page, width, `{Root plan} h2e2 {Main plan} (${branch}) *`);
          await openFinder(page);
          assert.equal(await results.count(), 20, 'The initial list must stay bounded');
          await page.getByTestId('study-notes').getByRole('status').filter({ hasText: '1025 notes' }).waitFor();
          await page.getByRole('button', { name: 'Show 20 more notes', exact: true }).click();
          assert.equal(await results.count(), 40);
          assert.equal(await results.nth(20).evaluate(element => element === document.activeElement), true,
            'Loading more notes must focus the first newly revealed result');
          const list = page.getByTestId('study-notes').locator('ul');
          await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
          assert.ok(await list.evaluate(element => element.scrollTop > 0));
          await search.fill('Side note');
          assert.equal(await results.count(), 20);
          assert.equal(await list.evaluate(element => element.scrollTop), 0,
            'A new note search must start at the first matching result');
          await search.fill('Side note 1023');
          assert.equal(await results.count(), 1, 'Search must reach beyond rendered tree/list limits');
          await results.first().click();
          await noteIs(page, 'Side note 1023');
          await search.fill('');
          assert.equal(await results.count(), 20, 'Changing a filter resets progressive rendering');
          await search.fill('Root plan');
          await results.first().click();
          await noteIs(page, 'Root plan');
        }
        // Rapid reset/paste used to let the old passive reset erase the first edit.
        // Reuse the same draft and node ID without waiting for an empty editor.
        for (let run = 0; run < (width === 320 ? 80 : 1); run++) {
          await command(page, 'New game');
          await command(page, 'Write a note on this move');
          await page.getByTestId('move-comment-input').fill('Starting position lesson');
          await page.getByTestId('move-comment-input').blur();
          await openFinder(page);
          assert.equal(await results.count(), 1, 'A root-only study must have a finder');
          assert.match(await results.first().innerText(), /Starting position/);
          await results.first().click();
          await noteIs(page, 'Starting position lesson');
        }
        // Hold only Write note's scheduled focus, then open a second palette.
        // Its stale callback must not move Enter into the textarea behind it.
        await page.evaluate(() => {
          const native = window.setTimeout;
          window.setTimeout = function(callback, delay, ...args) {
            if (delay === 0 && document.querySelector('[data-command-input]')?.value === 'Write a note on this move') {
              window.__heldNoteFocus = () => callback(...args);
              window.setTimeout = native;
              return native(() => {}, 0);
            }
            return native(callback, delay, ...args);
          };
        });
        await command(page, 'Write a note on this move');
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Find study notes');
        await page.evaluate(() => { window.__heldNoteFocus(); });
        assert.equal(await page.getByRole('combobox', { name: 'Search commands' }).evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Enter');
        await search.waitFor({ state: 'visible' });
        // The finder moves focus to its search a moment after it is visible.
        // Filling the note before that let the move land between fill's focus
        // and its delete, which then cleared the search instead of the note,
        // and the panel this waits to disappear stayed (about one run in six).
        await page.waitForFunction(() => document.activeElement?.id === 'study-notes-search');
        await page.getByTestId('move-comment-input').fill('');
        await page.getByTestId('move-comment-input').blur();
        await page.getByTestId('study-notes').waitFor({ state: 'detached' });
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Find study notes');
        assert.equal(await page.getByRole('option').first().getAttribute('aria-disabled'), 'true');
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: all-branch search, draft retention, keyboard jumps, saved notes, notation and 200% reflow passed${width === 1440 ? '; 1,024-move study rendered only 20 initial results' : ''}`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
