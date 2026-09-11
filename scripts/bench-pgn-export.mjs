import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Isolated export cost, not download latency or browser responsiveness. The
// current study limit is 1,024 nodes; timing is evidence, never a test threshold.
const server = await createServer({ server: { middlewareMode: true } });
try {
  console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, scope: 'PGN text generation only' }));
  const { exportPgnTree } = await server.ssrLoadModule('/src/utils/gameExport.ts');
  const { extractUciMoveLine } = await server.ssrLoadModule('/src/utils/moveImport.ts');
  for (const plies of [128, 512, 1024]) {
    const tree = { root: { id: 'root', parentId: null, childrenIds: ['n0'] } };
    const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
    const moves = Array.from({ length: plies }, (_, i) => cycle[i % 4]);
    for (let i = 0; i < plies; i++) tree[`n${i}`] = {
      id: `n${i}`, parentId: i ? `n${i - 1}` : 'root', childrenIds: i + 1 < plies ? [`n${i + 1}`] : [],
      record: { uci: moves[i], ...(i % 20 === 0 ? { comment: '保留这条变化。 Keep this continuation.', evalScore: 35 } : {}) },
    };
    const run = () => exportPgnTree(tree, 'root', { date: '2026.09.11' });
    assert.deepEqual(extractUciMoveLine(run()), moves);
    for (let i = 0; i < 10; i++) run();
    const times = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now(); run(); times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ plies, samples: times.length,
      medianMs: +times[25].toFixed(3), p95Ms: +times[47].toFixed(3) }));
  }
} finally { await server.close(); }
