import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Isolated JavaScript work only: excludes rendering, JSON encoding, storage,
// and engine search. No timing threshold is used as a correctness test.
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { serializeSavedMoveTree } = await server.ssrLoadModule('/src/utils/savedMoveTree.ts');
  const { normalizeMoveComment } = await server.ssrLoadModule('/src/utils/moveComment.ts');

  // Algorithm shipped before this optimization, retained for comparison.
  function baseline(tree, parentId, seen = new Set()) {
    const parent = tree[parentId];
    if (!parent || seen.has(parentId)) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(parentId);
    return parent.childrenIds.map(childId => {
      const child = tree[childId];
      const uci = child?.record?.uci;
      if (!child || !uci) return null;
      const children = baseline(tree, childId, nextSeen);
      const comment = normalizeMoveComment(child.record?.comment);
      return { uci, ...(comment ? { comment } : {}), ...(children.length ? { children } : {}) };
    }).filter(Boolean);
  }

  for (const plies of [128, 512, 1024]) {
    const tree = { root: { childrenIds: ['n0'] } };
    const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
    for (let i = 0; i < plies; i++) tree[`n${i}`] = {
      childrenIds: i + 1 < plies ? [`n${i + 1}`] : [],
      record: { uci: cycle[i % 4], ...(i % 10 === 0 ? { comment: '保留这条变化。 Keep this continuation.' } : {}) },
    };
    assert.equal(JSON.stringify(serializeSavedMoveTree(tree, 'root')), JSON.stringify(baseline(tree, 'root')));
    const runs = { baseline: () => baseline(tree, 'root'), current: () => serializeSavedMoveTree(tree, 'root') };
    for (let i = 0; i < 10; i++) for (const run of Object.values(runs)) run();
    const samples = { baseline: [], current: [] };
    for (let i = 0; i < 50; i++) {
      const order = i % 2 ? ['current', 'baseline'] : ['baseline', 'current'];
      for (const name of order) {
        const start = performance.now();
        runs[name]();
        samples[name].push(performance.now() - start);
      }
    }
    for (const [name, times] of Object.entries(samples)) {
      times.sort((a, b) => a - b);
      console.log(JSON.stringify({ plies, implementation: name, samples: times.length,
        medianMs: +times[25].toFixed(3), p95Ms: +times[47].toFixed(3) }));
    }
  }
} finally { await server.close(); }
