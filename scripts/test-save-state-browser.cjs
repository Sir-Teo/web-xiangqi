const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
const command = async (page,label) => {await page.keyboard.press('ControlOrMeta+k'); await page.getByRole('combobox').fill(label);await page.keyboard.press('Enter');};

async function savePendingNote(page, text) {
 const note = page.getByTestId('move-comment-input');
 const status = page.getByTestId('study-save-status');
 await note.focus();
 // Save while the note debounce is paused, without a blur to commit it.
 // WebKit may leave the field focused when a save button is activated.
 await note.fill(text);
 assert.match(await status.textContent(), /Modified study/);
 await status.evaluate(button => button.click());
 await page.waitForFunction(()=>document.querySelector('[data-testid="study-save-status"]').textContent.includes('Saved study'));
 return page.evaluate(()=>JSON.parse(localStorage.getItem('xiangqi:library:v1'))[0]);
}

(async () => {
 const browser = await browserType.launch();
 try {
  for (const width of [1440,390,320]) {
   const page = await browser.newPage({viewport:{width,height:844}});
   const clockStart = new Date('2026-01-01T00:00:00Z');
   await page.clock.install({ time: clockStart });
   await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
   await page.goto(base+'?moves=h2e2+h9g7'); await page.locator('.xiangqi-board').waitFor();
   const status=page.getByTestId('study-save-status');
   assert.match(await status.textContent(),/Unsaved study/); await status.click();
   await page.waitForFunction(()=>document.querySelector('[data-testid="study-save-status"]').textContent.includes('Saved study'));
   await command(page,'Go to start');
   await command(page,'Move tree');
   await page.getByRole('textbox', { name: 'Note on starting position', exact: true }).waitFor();
   assert.match(await status.textContent(), /Saved study/);
   const saved = await savePendingNote(page, 'New root note');
   assert.equal(saved.rootComment, 'New root note');
   assert.equal((await savePendingNote(page, '')).rootComment, undefined);
   await command(page, 'Go to latest move');
   await page.waitForFunction(() => {
    const field = document.querySelector('[data-testid="move-comment-input"]');
    return field && field.getAttribute('aria-label') !== 'Note on starting position';
   });
   const moveSaved = await savePendingNote(page, 'Pending move note');
   assert.equal(moveSaved.id, saved.id);
   assert.equal(moveSaved.moveTree[0].children[0].comment, 'Pending move note');
   const cleared = await savePendingNote(page, '');
   assert.equal(cleared.moveTree[0].children[0].comment, undefined);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.close();
  }
  console.log('PASS: save indicator tracks navigation and saves/clears pending root and move notes before debounce at three widths');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
