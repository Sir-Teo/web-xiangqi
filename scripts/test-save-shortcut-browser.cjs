const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';

async function command(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Search commands' }).waitFor({ state: 'hidden' });
}

(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        const clockStart = new Date('2026-01-01T00:00:00Z');
        await page.clock.install({ time: clockStart });
        await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
        await page.goto(base);
        if (width < 900) await page.getByTestId('mobile-view-analysis').click();
        const status = page.getByTestId('study-save-status');
        const note = page.getByTestId('move-comment-input');
        const games = () => page.evaluate(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]'));
        const savedNote = text => page.waitForFunction(text => {
          const games = JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]');
          return games.length === 1 && games[0].rootComment === text
            && document.querySelector('[data-testid="study-save-status"]')?.textContent.includes('Saved study');
        }, text);
        const chord = flags => note.evaluate((element, flags) => {
          const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true, ...flags });
          if (flags.prePrevented) event.preventDefault();
          element.dispatchEvent(event);
          return event.defaultPrevented;
        }, flags);
        assert.equal(await status.isDisabled(), true);
        assert.equal(await chord({}), true, 'The empty study must not trigger the browser Save Page action');
        assert.deepEqual(await games(), []);
        assert.equal(await status.getAttribute('aria-keyshortcuts'), 'Meta+S Control+S');
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: 'Search commands' }).fill('Save game');
        assert.match(await page.locator('[data-command-id="save-game"] .command-palette-key').innerText(), /Ctrl\+S|⌘S/);
        await page.keyboard.press('Escape');

        await note.fill('Root lesson saved before debounce');
        assert.equal(await status.isEnabled(), true, 'A pending root note must enable Save immediately');
        await page.keyboard.press('ControlOrMeta+s');
        await savedNote('Root lesson saved before debounce');
        assert.equal(await note.evaluate(element => element === document.activeElement), true, 'Saving keeps keyboard focus in the note');
        const id = (await games())[0].id;
        await note.fill('Updated root lesson');
        await page.keyboard.press('ControlOrMeta+s');
        await savedNote('Updated root lesson');
        assert.equal((await games())[0].id, id, 'The second save updates the opened study instead of adding a copy');

        await note.fill('Pending shortcut guard checks');
        const before = await games();
        for (const flags of [{ repeat: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { prePrevented: true }]) {
          const prevented = await chord(flags);
          assert.equal(prevented, Boolean(flags.repeat || flags.prePrevented));
          // Negative paths need a quiet window for any mistaken async write.
          await new Promise(resolve => setTimeout(resolve, 75));
          assert.deepEqual(await games(), before, `The shortcut must ignore ${JSON.stringify(flags)}`);
        }
        assert.equal(await chord({ ctrlKey: false, metaKey: true }), true);
        await savedNote('Pending shortcut guard checks');
        assert.equal((await games())[0].id, id, 'The Meta chord also updates the same study');

        await note.fill('Pending modal guard check');
        await command(page, 'Settings');
        await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
        const beforeDialogChord = await games();
        const blocked = await page.getByRole('dialog', { name: 'Settings', exact: true }).evaluate(element => {
          const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        });
        assert.equal(blocked, false, 'The save shortcut must leave an open dialog alone');
        await new Promise(resolve => setTimeout(resolve, 75));
        assert.deepEqual(await games(), beforeDialogChord);
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
        await page.keyboard.press('ControlOrMeta+s');
        await savedNote('Pending modal guard check');

        await page.getByTestId('game-metadata').locator('summary').click();
        const player = page.getByLabel('Red player', { exact: true });
        await player.fill('Alice');
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]')[0]?.metadata?.redPlayer === 'Alice');
        assert.equal(await player.evaluate(element => element === document.activeElement), true);
        assert.equal((await games()).length, 1);
        await page.keyboard.press('ControlOrMeta+k');
        const search = page.getByRole('combobox', { name: 'Search commands' });
        await search.fill('Update saved study');
        assert.match(await page.locator('[data-command-id="update-saved-study"] .command-palette-key').innerText(), /Ctrl\+S|⌘S/);
        await search.fill('Save game');
        assert.equal(await page.locator('[data-command-id="save-game"] .command-palette-key').count(), 0,
          'The copy command must not advertise the update shortcut');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        assert.deepEqual(errors, []);
        console.log(`${browserType.name()} ${width}px: immediate root-note save, same-study updates, editor focus, Meta/Ctrl and modal/IME/repeat guards passed`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
