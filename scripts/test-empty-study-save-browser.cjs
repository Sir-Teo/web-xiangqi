const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width === 320 ? 640 : 900 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'note-only', savedAt: 1, gameMode: 'PvP', label: 'Note study', moves: [], rootComment: 'Only note' },
          { id: 'metadata-only', savedAt: 2, gameMode: 'PvP', label: 'Tournament study', moves: [], metadata: { event: 'Open Cup' } },
        ])));
        const clockStart = new Date('2026-01-01T00:00:00Z');
        await page.clock.install({ time: clockStart });
        await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
        await page.goto(base);
        await page.getByTestId(width < 900 ? 'mobile-open-library-btn' : 'left-panel-tab-library').click();
        const status = page.getByTestId('study-save-status');
        const notice = page.getByTestId('empty-study-save-notice');
        const stored = () => page.evaluate(() => localStorage.getItem('xiangqi:library:v1'));
        for (const id of ['note-only', 'metadata-only']) {
          await page.getByTestId(`load-saved-${id}`).click();
          const field = id === 'note-only' ? page.getByTestId('move-comment-input') : page.getByLabel('Event', { exact: true });
          if (id === 'metadata-only') await page.getByTestId('game-metadata').locator('summary').click();
          const original = await field.inputValue();
          const before = await stored();
          await field.fill('');
          assert.equal(await status.isDisabled(), true, 'Clearing the last field disables Save before the note debounce');
          await notice.waitFor();
          assert.match(await notice.innerText(), /Add content to update the saved copy/);
          assert.match(await status.getAttribute('aria-describedby'), /empty-study-save-help/);
          assert.match(await status.getAttribute('title'), /Add a move, note, or game details/);
          await page.keyboard.press('ControlOrMeta+s');
          await new Promise(resolve => setTimeout(resolve, 75));
          assert.equal(await stored(), before, 'An empty shortcut save must preserve the existing library copy');
          assert.equal(await page.getByTestId('save-game-error').count(), 0, 'A disabled empty save must not raise a storage failure');
          for (const size of [16, 32]) {
            await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
            const open = notice.getByRole('button', { name: 'Open library', exact: true });
            await open.scrollIntoViewIfNeeded();
            const explanation = await notice.locator('#empty-study-save-help').evaluate(element => {
              const text = element.getBoundingClientRect();
              const stack = element.closest('.app-notice-stack').getBoundingClientRect();
              return { visible: text.top >= stack.top - 1 && text.bottom <= stack.bottom + 1
                && text.top >= 0 && text.bottom <= innerHeight,
                text: { top: text.top, bottom: text.bottom }, stack: { top: stack.top, bottom: stack.bottom }, viewport: innerHeight };
            });
            assert.equal(explanation.visible, true, `The explanation must stay visible alongside its action: ${width}px ${size}px text ${id} ${JSON.stringify(explanation)}`);
            assert.equal(await notice.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            assert.equal(await open.evaluate(element => {
              const rect = element.getBoundingClientRect();
              return rect.height >= 44 && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
            }), true, 'The library action stays reachable at 200% text size');
          }
          await page.screenshot({ path: `/tmp/xiangqi-empty-study-${browserType.name()}-${width}-${id}.png` });
          await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
          await notice.getByRole('button', { name: 'Open library', exact: true }).click();
          await page.getByTestId('saved-game-list').waitFor({ state: 'visible' });
          assert.equal(await stored(), before, 'Opening the library must not erase the original study');
          await page.getByTestId(`load-saved-${id}`).click();
          await notice.waitFor({ state: 'hidden' });
          if (id === 'metadata-only' && await page.getByTestId('game-metadata').getAttribute('open') === null) {
            await page.getByTestId('game-metadata').locator('summary').click();
          }
          assert.equal(await field.inputValue(), original, 'The original note or metadata remains loadable');
          await field.fill('Replacement content');
          assert.equal(await status.isEnabled(), true);
          assert.equal(await notice.count(), 0);
          await page.keyboard.press('ControlOrMeta+s');
          await page.waitForFunction(id => {
            const games = JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]');
            const game = games.find(game => game.id === id);
            return games.length === 2 && (id === 'note-only' ? game?.rootComment : game?.metadata?.event) === 'Replacement content';
          }, id);
          if (width < 900) await page.getByTestId('mobile-analysis-tab-library').click();
          else await page.getByTestId('left-panel-tab-library').click();
        }
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: empty note/metadata save guidance, preserved library copies, reachable 200% text action and replacement saves passed`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-empty-study-failure-${browserType.name()}-${width}.png` }).catch(() => {});
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
