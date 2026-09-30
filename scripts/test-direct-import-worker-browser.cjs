const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const RealWorker = window.Worker;
      window.importWorkers = [];
      window.Worker = class extends RealWorker {
        constructor(url, options) {
          if (!String(url).includes('directImport.worker')) return new RealWorker(url, options);
          const worker = { postMessage() {}, terminate() { this.terminated = true; }, terminated: false };
          window.importWorkers.push(worker);
          return worker;
        }
      };
    });
    await page.clock.install();
    await page.goto(base);
    await page.getByRole('button', { name: 'Start new game', exact: true }).click();
    await page.getByTestId('uci-line-input').fill('h2e2 h9g7');
    await page.getByTestId('import-uci-line-btn').click();
    await page.getByRole('button', { name: 'Cancel reading', exact: true }).click();
    assert.equal(await page.evaluate(() => window.importWorkers[0].terminated), true);
    assert.equal(await page.getByTestId('import-uci-line-btn').isEnabled(), true);
    await page.getByTestId('import-uci-line-btn').click();
    await page.clock.fastForward(30_001);
    await page.getByRole('alert').filter({ hasText: 'took too long' }).waitFor();
    assert.equal(await page.evaluate(() => window.importWorkers[1].terminated), true);
    await page.getByTestId('import-uci-line-btn').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.importWorkers[2].terminated), true);
    await page.evaluate(() => window.importWorkers[2].onmessage({ data: { kind: 'plan', plan: { kind: 'error', message: 'Late error' } } }));
    assert.equal(await page.getByText('Late error').count(), 0);
    await page.close();
    console.log('PASS: direct import remains cancellable, terminates on timeout/dismissal, and ignores late replies');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
