import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { relative } from 'node:path';

// Build in memory: do not replace the production app or its engine artifacts.
// Static imports count toward startup even when Vite puts them in other files.
const result = await build({ logLevel: 'silent', build: { write: false, copyPublicDir: false } });
if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one production output.');
const chunks = new Map(result.output.filter(item => item.type === 'chunk').map(chunk => [chunk.fileName, chunk]));
const startup = new Set();
function visit(name) {
  if (startup.has(name)) return;
  const chunk = chunks.get(name);
  if (!chunk) return;
  startup.add(name);
  for (const dependency of chunk.imports) visit(dependency);
}
for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName);
const sizes = chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length });
const initial = [...startup].map(name => sizes(chunks.get(name)));
const modules = [...startup].flatMap(name => Object.entries(chunks.get(name).modules)
  .map(([id, module]) => ({ module: relative(process.cwd(), id), renderedLength: module.renderedLength })));
console.log(JSON.stringify({
  scope: 'Production JavaScript static dependency closure; excludes CSS, dynamic imports, workers, engine assets and runtime downloads. Gzip sizes are calculated, not observed transfers. Module lengths are pre-minification attribution, not additive compressed sizes.',
  initial,
  totalBytes: initial.reduce((sum, chunk) => sum + chunk.bytes, 0),
  totalGzipBytes: initial.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
  deferred: [...chunks.values()].filter(chunk => !startup.has(chunk.fileName)).map(sizes),
  largestStartupModules: modules.sort((a, b) => b.renderedLength - a.renderedLength).slice(0, 20),
}, null, 2));
