const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Fresh-context observations, not CI gates or physical-phone measurements.
// Includes fixture setup and shell/recovery rendering; the engine stays off.
(async () => {
  const urls = { current: process.env.XIANGQI_QA_URL || 'http://127.0.0.1:8196/web-xiangqi/' };
  if (process.env.XIANGQI_QA_BASELINE_URL) urls.baseline = process.env.XIANGQI_QA_BASELINE_URL;
  const samples = Object.fromEntries(Object.keys(urls).map(name => [name, []]));
  const browser = await chromium.launch();
  try {
    for (let repeat = 0; repeat < 3; repeat++) {
      const names = Object.keys(urls);
      for (const name of repeat % 2 ? names.reverse() : names) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        try {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await page.addInitScript(() => {
            const cycle = ['a9a8', 'a0a1', 'a8a9', 'a1a0'];
            const moveTree = Array.from({ length: 64 }, (_, branch) => {
              let nodes = [];
              for (let ply = 127; ply >= 0; ply--) nodes = [{
                uci: ply === 0 ? 'h2e2' : cycle[(ply - 1) % 4],
                comment: `Branch ${branch} note ${ply} ` + 'x'.repeat(128),
                ...(nodes.length ? { children: nodes } : {}),
              }];
              return nodes[0];
            });
            const game = { id: 'recovery-perf', savedAt: 1, gameMode: 'PvP', moves: ['h2e2'], moveTree };
            const raw = JSON.stringify({ version: 1, draftId: 'recovery-bench', savedAt: 1, game });
            localStorage.setItem('xiangqi:recovery-draft:v1:recovery-bench', raw);
            localStorage.setItem('xiangqi:auto-saved-game:v1', raw);
            window.__recoveryBench = { bytes: raw.length, parses: 0, parseMs: 0, longTasks: [] };
            const parse = JSON.parse;
            JSON.parse = function(value, ...args) {
              if (value !== raw) return parse.call(this, value, ...args);
              const start = performance.now();
              const result = parse.call(this, value, ...args);
              window.__recoveryBench.parseMs += performance.now() - start;
              window.__recoveryBench.parses++;
              return result;
            };
            new PerformanceObserver(list => window.__recoveryBench.longTasks.push(...list.getEntries().map(entry => entry.duration)))
              .observe({ type: 'longtask', buffered: true });
          });
          await page.goto(urls[name]);
          await page.getByRole('dialog', { name: 'Unfinished game', exact: true }).waitFor();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const result = await page.evaluate(() => ({
            bytes: window.__recoveryBench.bytes, parses: window.__recoveryBench.parses, parseMs: window.__recoveryBench.parseMs,
            fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
            longestTaskMs: Math.max(0, ...window.__recoveryBench.longTasks),
          }));
          assert.ok(result.parses > 0 && Number.isFinite(result.fcpMs), 'Startup probe did not observe the fixture');
          samples[name].push(result);
        } finally { await page.close(); }
      }
    }
    for (const [implementation, runs] of Object.entries(samples)) {
      const median = key => runs.map(run => run[key]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
      console.log(JSON.stringify({ implementation, cpuThrottle: 4, nodes: 8192, samples: runs.length,
        bytes: median('bytes'), parses: median('parses'), medianParseMs: median('parseMs'),
        medianFcpMs: median('fcpMs'), medianLongestTaskMs: median('longestTaskMs'), runs }));
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
