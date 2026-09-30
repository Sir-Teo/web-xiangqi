const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
 const browser = await browserType.launch();
 try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
   localStorage.setItem('xiangqi:library:v1', JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: 'search-' + i, savedAt: i + 1, gameMode: 'PvP', moves: ['h2e2'], rootComment: i === 199 ? 'unique needle' : 'ordinary' }))));
   const schedule = window.setTimeout;
   window.searchTasks = new Map(); window.searchBuilds = 0; let taskId = 999999;
   const clear = window.clearTimeout;
   window.clearTimeout = id => { if (!window.searchTasks.delete(id)) clear(id); };
   window.setTimeout = (handler, ...args) => {
    if (typeof handler === 'function' && handler.name === 'prepare') { window.searchTasks.set(++taskId, handler); return taskId; }
    return schedule(handler, ...args);
   };
  });
  await page.route('**/src/components/Library/LibraryPanel.tsx*', async route => {
   const response = await route.fetch(); const body = await response.text();
   const marker = 'function getSavedGameSearchText(game, line, studyLineLabel) {';
   assert.ok(body.includes(marker));
   await route.fulfill({ response, body: body.replace(marker, marker + ' window.searchBuilds++;') });
  });
  await page.goto(base);
  await page.getByTestId('left-panel-tab-library').click();
  const search = page.getByRole('searchbox', { name: 'Search library' });
  await search.fill('unique needle');
  await page.getByRole('status').filter({ hasText: 'Preparing library search' }).waitFor();
  assert.equal(await page.evaluate(() => window.searchBuilds), 0, 'Typing must not construct search text');
  await page.evaluate(() => { while (window.searchTasks.size) { const [id, run] = window.searchTasks.entries().next().value; window.searchTasks.delete(id); run(); } });
  await page.getByTestId('load-saved-search-199').waitFor();
  assert.equal(await page.locator('[data-testid^="load-saved-search-"]').count(), 1);
  await search.fill('ordinary');
  assert.equal(await page.evaluate(() => window.searchBuilds), 200, 'Later queries reuse prepared text');
  console.log('PASS: first keystroke does not prepare study text; background completion publishes complete search results');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
