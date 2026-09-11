const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const expected = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};

(async () => {
  const { createServer, preview } = await import('vite');
  for (const mode of ['development', 'preview']) {
    const server = mode === 'development'
      ? await createServer({ server: { host: '127.0.0.1', port: 0 } })
      : await preview({ preview: { host: '127.0.0.1', port: 0 } });
    try {
      if (mode === 'development') await server.listen();
      const builtWorker = mode === 'preview'
        ? fs.readdirSync(path.join(__dirname, '../dist/assets')).find(name => /^positionExplorer\.worker-.*\.js$/.test(name))
        : null;
      if (mode === 'preview') assert.ok(builtWorker, 'Build the app before checking preview headers');
      const worker = mode === 'development'
        ? 'src/workers/positionExplorer.worker.ts?worker_file&type=module'
        : `assets/${builtWorker}`;
      for (const resource of ['pikafish.js', worker]) {
        const url = new URL(resource, server.resolvedUrls.local[0]);
        const first = await fetch(url);
        assert.equal(first.status, 200, `${mode}: ${resource} initial response`);
        await first.arrayBuffer();
        const etag = first.headers.get('etag');
        assert.ok(etag, `${mode}: ${resource} must support revalidation`);
        const cached = await fetch(url, { headers: { 'If-None-Match': etag } });
        assert.equal(cached.status, 304, `${mode}: ${resource} must reuse cached bytes`);
        for (const [header, value] of Object.entries(expected)) {
          assert.equal(first.headers.get(header), value, `${mode}: ${resource} 200 ${header}`);
          assert.equal(cached.headers.get(header), value, `${mode}: ${resource} 304 ${header}`);
        }
      }
      console.log(`${mode}: worker isolation headers survive 200/304 revalidation`);
    } finally {
      if (mode === 'development') await server.close();
      else await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
