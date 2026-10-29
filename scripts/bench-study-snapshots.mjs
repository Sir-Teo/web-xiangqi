import assert from 'node:assert/strict';
import { createServer } from 'vite';
// Same stored output; compare repeated automatic score updates. Excludes UI,
// tree-state copying, JSON encoding/storage and engine search. Run alone.
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { createSavedMoveTreeSerializer, serializeSavedMoveTree } = await server.ssrLoadModule('/src/utils/savedMoveTree.ts');
  for (const nodes of [1024, 8192]) {
    const tree = { root: { id: 'root', parentId: null, childrenIds: ['n0'] } };
    const cycle = ['a0a1', 'a9a8', 'a1a0', 'a8a9'];
    for (let index = 0; index < nodes; index++) {
      const childrenIds = [index * 2 + 1, index * 2 + 2].filter(child => child < nodes).map(child => 'n' + child);
      const uci = cycle[index % cycle.length];
      tree['n' + index] = { id: 'n' + index, parentId: index ? 'n' + Math.floor((index - 1) / 2) : 'root', childrenIds,
        record: { uci, comment: index % 8 ? undefined : 'Retain the annotated continuation 新注',
          analysis: index % 8 ? undefined : { version: 1, position: 'position startpos', move: uci, score: 20,
            scoreKind: 'cp', bounded: false, depth: 18, savedAt: 1, multiPv: 1,
            engine: { name: 'Pikafish', variant: 'single-simd', threads: 1, hashMB: 16 } } } };
    }
    const cached = createSavedMoveTreeSerializer();
    const initial = cached(tree, 'root'), bytes = JSON.stringify(initial);
    const times = { uncached: [], cached: [] };
    for (let index = 0; index < 60; index++) {
      const id = 'n' + (index % nodes);
      const updated = { ...tree, [id]: { ...tree[id], record: { ...tree[id].record, evalScore: index } } };
      for (const name of index % 2 ? ['cached', 'uncached'] : ['uncached', 'cached']) {
        const start = performance.now();
        const result = name === 'cached' ? cached(updated, 'root') : serializeSavedMoveTree(updated, 'root');
        const elapsed = performance.now() - start;
        assert.equal(JSON.stringify(result), bytes);
        if (name === 'cached') assert.equal(result, initial);
        if (index >= 10) times[name].push(elapsed);
      }
    }
    for (const [implementation, samples] of Object.entries(times)) {
      samples.sort((a, b) => a - b);
      console.log(JSON.stringify({ nodes, implementation, samples: samples.length,
        medianMs: +samples[24].toFixed(3), p95Ms: +samples[47].toFixed(3) }));
    }
  }
} finally { await server.close(); }
