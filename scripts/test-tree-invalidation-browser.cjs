const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5173/web-xiangqi/';
(async () => {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/src/App.tsx*', async route => {
      const response = await route.fetch();
      const source = await response.text();
      assert.ok(source.includes('const viewportWidth ='));
      await route.fulfill({ response, body: source.replace('const viewportWidth =', 'window.treeAudit = { treeNodes, moveStructure, currentNodeId, setNodeComment, setCurrentNodeEval, applyUciMove, deleteNode }; const viewportWidth =') });
    });
    await page.goto(base + '?moves=h2e2,h9g7');
    await page.waitForFunction(() => window.treeAudit?.treeNodes[window.treeAudit.currentNodeId]?.record?.uci === 'h9g7');
    await page.evaluate(() => {
      window.originalStructure = window.treeAudit.moveStructure;
      window.originalTree = window.treeAudit.treeNodes;
      window.treeAudit.setNodeComment(window.treeAudit.currentNodeId, 'Annotation only');
      window.treeAudit.setCurrentNodeEval(42);
    });
    await page.waitForFunction(() => window.treeAudit.treeNodes[window.treeAudit.currentNodeId].record.comment === 'Annotation only');
    assert.equal(await page.evaluate(() => window.treeAudit.moveStructure === window.originalStructure), true);
    assert.equal(await page.evaluate(() => window.treeAudit.treeNodes === window.originalTree), false);
    await page.evaluate(() => window.treeAudit.applyUciMove('b0c2'));
    await page.waitForFunction(() => window.treeAudit.moveStructure !== window.originalStructure);
    assert.equal(await page.evaluate(() => Object.keys(window.treeAudit.moveStructure).length), 4);
    await page.evaluate(() => window.treeAudit.deleteNode(window.treeAudit.currentNodeId));
    await page.waitForFunction(() => Object.keys(window.treeAudit.moveStructure).length === 3);
    console.log('PASS: annotation/evaluation updates retain structural identity; adding and deleting moves invalidate it');
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
