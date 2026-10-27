const assert = require('node:assert/strict');
const { browserType } = require('./qa-browser.cjs');
const base = process.env.XIANGQI_QA_URL || 'http://127.0.0.1:5199/web-xiangqi/';
async function queryStaysVisible(browser) {
  for (const [width, height] of [[844, 390], [1440, 900], [320, 480], [390, 640], [480, 400], [844, 320]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce' });
    try {
      await page.goto(base); await page.locator('.xiangqi-board').waitFor();
      for (const size of [16, 32]) {
        const appliedSize = await page.evaluate(size => {
          document.documentElement.style.fontSize = size + 'px';
          return parseFloat(getComputedStyle(document.documentElement).fontSize);
        }, size);
        assert.equal(appliedSize, size, 'Reduced motion must apply text resizing immediately');
        await page.keyboard.press('ControlOrMeta+k');
        const input = page.getByRole('combobox', { name: 'Search commands' });
        const checkVisible = async (key, hasSelection) => {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const state = await input.evaluate(node => {
            const rect = node.getBoundingClientRect(); const modal = node.closest('[role="dialog"]').getBoundingClientRect();
            const selected = document.getElementById(node.getAttribute('aria-activedescendant'));
            const option = selected?.getBoundingClientRect();
            return { query: node.value, option: option?.toJSON(), fontSize: selected ? parseFloat(getComputedStyle(selected.querySelector('.command-palette-label') ?? selected).fontSize) : null, focused: node === document.activeElement, top: rect.top, bottom: rect.bottom,
              visible: rect.top >= Math.max(0, modal.top) + 3 && rect.bottom <= Math.min(innerHeight, modal.bottom) - 3,
              reachable: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node,
              selectionVisible: !!option && option.top >= rect.bottom + 3
                && selected.contains(document.elementFromPoint(option.x + option.width / 2, option.y + option.height / 2)) };
          });
          if (!state.focused || !state.visible || !state.reachable || (hasSelection && !state.selectionVisible)) {
            await page.screenshot({ path: `/tmp/xiangqi-palette-query-failure-${browserType.name()}-${width}-${height}-${size}.png` });
          }
          const context = `${browserType.name()} ${width}x${height}/${size}px/${key}: ${JSON.stringify(state)}`;
          assert.equal(state.focused && state.visible && state.reachable, true, `The focused query must stay fully visible: ${context}`);
          if (hasSelection) {
            assert.equal(state.fontSize, size, `Command text must follow the requested text size: ${context}`);
            assert.equal(state.selectionVisible, true, `The selected command must stay clear of the input: ${context}`);
          }
        };
        for (const query of ['panel', '']) {
          await input.fill(query); await page.locator('.command-palette-button').first().waitFor();
          for (const key of ['Home', 'End', 'ArrowUp', 'Home']) {
            await page.keyboard.press(key); await checkVisible(key, true);
          }
        }
        await input.fill('no matching command zzz');
        assert.equal(await page.locator('.command-palette-button').count(), 0);
        for (const key of ['Tab', 'Shift+Tab']) { await page.keyboard.press(key); await checkVisible(key, false); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `/tmp/xiangqi-palette-query-visible-${browserType.name()}-${width}-${height}-${size}.png` });
        await page.keyboard.press('Escape');
      }
      console.log(`${browserType.name()} ${width}x${height}: focused query and selected commands stay reachable at 100/200% text; empty-result Tab stays in the query`);
    } finally { await page.close(); }
  }
}
async function forcedColorSelection(browser) {
  // Chromium can emulate both system palettes; regular pointer checks run in every engine.
  if (browserType.name() !== 'chromium') return;
  for (const colorScheme of ['light', 'dark']) {
    for (const [width, height] of [[1440, 900], [320, 480]]) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme, forcedColors: 'active', reducedMotion: 'reduce' });
      try {
        await page.goto(base); await page.locator('.xiangqi-board').waitFor();
        for (const size of [16, 32]) {
          await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px'; }, size);
          await page.keyboard.press('ControlOrMeta+k');
          const input = page.getByRole('combobox', { name: 'Search commands' });
          await input.fill('panel');
          const buttons = page.locator('.command-palette-button'); await buttons.first().waitFor();
          assert.equal(await buttons.count(), 2, 'Both panel commands must remain available');
          await page.keyboard.press('Home');
          const before = await buttons.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
          for (const key of ['ArrowDown', 'ArrowUp']) {
            await page.keyboard.press(key);
            const markers = await buttons.evaluateAll(nodes => nodes.map(node => {
              const style = getComputedStyle(node);
              return { selected: node.getAttribute('aria-selected') === 'true', height: node.getBoundingClientRect().height,
                marker: { borderStyle: style.borderTopStyle, borderWidth: style.borderTopWidth,
                  outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth } };
            }));
            assert.equal(markers.filter(marker => marker.selected).length, 1);
            assert.notDeepEqual(markers.find(marker => marker.selected).marker, markers.find(marker => !marker.selected).marker,
              `Selected commands need a visible shape difference under ${colorScheme} forced colors at ${width}px/${size}px`);
            markers.forEach((marker, index) => assert.ok(Math.abs(marker.height - before[index]) < 1, 'Changing selection must preserve row height'));
            assert.equal(await input.evaluate(node => node === document.activeElement), true);
          }
          await page.getByRole('dialog', { name: 'Commands', exact: true }).screenshot({ path: `/tmp/xiangqi-palette-selected-${colorScheme}-${width}-${size}.png` });
          await page.keyboard.press('Escape');
        }
        console.log(`chromium ${colorScheme} forced colors/${width}px: selection stays distinct without shifting rows at 100/200% text`);
      } finally { await page.close(); }
    }
  }
}
(async () => {
  const browser = await browserType.launch();
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      try {
        await page.goto(base + '?moves=h2e2');
        await page.waitForFunction(() => / b - - 1 1$/.test(document.querySelector('.bottombar-fen')?.title || ''));
        await page.keyboard.press('ControlOrMeta+k');
        const input = page.getByRole('combobox', { name: 'Search commands' });
        await input.waitFor();
        // After filtering, Library takes this row's place under the stationary
        // pointer. Layout-generated enter events must not override typing.
        await page.locator('[data-command-id="new-game"] button').hover();
        assert.equal(await input.getAttribute('aria-activedescendant'), 'command-new-game');
        await input.fill('Save game');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await input.getAttribute('aria-activedescendant'), 'command-save-game',
          'Filtering must keep keyboard selection when the pointer has not moved');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('xiangqi:library:v1') || '[]').length === 1);
        assert.equal(await page.getByRole('dialog').count(), 0);
        console.log(`${browserType.name()} ${width}px: stationary pointer cannot redirect a typed Save command`);
      } finally { await page.close(); }
    }
    await queryStaysVisible(browser);
    await forcedColorSelection(browser);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
