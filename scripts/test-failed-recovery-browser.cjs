const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    for (const raw of ['{damaged', JSON.stringify({ version: 1, savedAt: 1, game: { id: 'draft', savedAt: 1, gameMode: 'PvP', moves: ['a0a9'] } })]) {
      const page = await browser.newPage();
      page.setDefaultTimeout(10000);
      await page.addInitScript(raw => localStorage.setItem('xiangqi:auto-saved-game:v1', raw), raw);
      await page.goto(base);
      const malformed = raw === '{damaged';
      if (!malformed) {
        await page.getByRole('button', { name: 'Restore', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'could not be loaded' }).waitFor();
      }
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: malformed ? 'Download recovery data' : 'Download original data', exact: true }).click();
      const chunks = [];
      for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
      const downloaded = Buffer.concat(chunks).toString();
      assert.equal(malformed ? JSON.parse(downloaded)[0].raw : downloaded, raw);
      assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi:auto-saved-game:v1')), raw);
      await page.close();
    }
    console.log('PASS: unreadable and illegal recovery records retain downloadable original bytes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
