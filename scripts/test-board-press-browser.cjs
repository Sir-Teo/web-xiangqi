const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
async function command(page, name) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(name);
  await page.keyboard.press('Enter');
}
async function holdSquare(page, scope, file, rank) {
  const square = scope.locator(`.hitbox[data-file="${file}"][data-rank="${rank}"]`);
  await square.scrollIntoViewIfNeeded();
  const before = await square.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  try {
    // Let the app's 50ms press animation finish while the pointer stays down.
    await page.waitForTimeout(120);
    const held = await square.boundingBox();
    assert.ok(Math.abs(held.x - before.x) < 1 && Math.abs(held.y - before.y) < 1
      && Math.abs(held.width - before.width) < 1 && Math.abs(held.height - before.height) < 1,
    `A held square must stay under the pointer: ${JSON.stringify({ before, held })}`);
  } finally { await page.mouse.up(); }
}
async function longPressMarker(page, board) {
  const square = board.locator('.hitbox[data-file="4"][data-rank="4"]');
  await square.scrollIntoViewIfNeeded();
  const box = await square.boundingBox();
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await page.waitForFunction(() => document.querySelectorAll('.marker-highlight').length === 1);
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
  assert.equal(await board.locator('.piece.selected').count(), 0, 'A long press must mark the square without selecting or moving a piece');
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900 });
      try {
        await page.addInitScript(() => localStorage.setItem('xiangqi:library:v1', JSON.stringify([
          { id: 'press', savedAt: 1, gameMode: 'PvP', moves: ['h2e2', 'h9g7'] },
        ])));
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        const board = page.locator('.xiangqi-board').first();
        await board.locator('.hitbox[data-file="7"][data-rank="9"]').click();
        await holdSquare(page, board, 6, 7);
        await page.waitForFunction(() => / w - - 2 2$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        if (width < 900) {
          await board.locator('.hitbox[data-file="1"][data-rank="0"]').tap();
          await board.locator('.hitbox[data-file="2"][data-rank="2"]').tap();
          await page.waitForFunction(() => / b - - 3 2$/.test(document.querySelector('.bottombar-fen')?.title || ''));
          // Chromium's native touch protocol can hold a finger between events;
          // Playwright's cross-browser touchscreen API only exposes tap.
          if (browserType.name() === 'chromium') await longPressMarker(page, board);
        }
        const originalFen = await page.locator('.bottombar-fen').getAttribute('title');

        await command(page, 'Learn the rules');
        const lessons = page.getByTestId('rule-lessons');
        await lessons.waitFor();
        await holdSquare(page, lessons, 0, 7);
        await page.waitForFunction(() => document.querySelector('[data-testid="lesson-feedback"]')?.getAttribute('data-solved') === 'true');
        await page.keyboard.press('Escape');

        await command(page, 'Library');
        await page.getByTestId('practice-saved-press').click();
        const practice = page.getByTestId('study-practice-dialog');
        await practice.locator('.hitbox[data-file="7"][data-rank="2"]').click();
        await holdSquare(page, practice, 4, 2);
        await practice.getByRole('button', { name: 'Play saved reply', exact: true }).waitFor();
        await page.keyboard.press('Escape');

        await command(page, 'Set up a position');
        const editor = page.getByTestId('board-editor');
        await editor.getByTestId('editor-brush-R').click();
        await holdSquare(page, editor, 0, 4);
        assert.match(await editor.locator('.hitbox[data-file="0"][data-rank="4"]').getAttribute('aria-label'), /Red chariot/);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.bottombar-fen').getAttribute('title'), originalFen, 'Exercises and cancelled setup must preserve the game');
        console.log(`${browserType.name()} ${width}x${height}: held presses keep square targets fixed and activate play, lesson, practice and editor actions`);
      } catch (error) {
        await page.screenshot({ path: `/tmp/xiangqi-board-press-${browserType.name()}-${width}-failure.png` });
        throw error;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
