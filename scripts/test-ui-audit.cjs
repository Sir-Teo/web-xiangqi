const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { scripts, selectShard } = require('./ui-audit-suites.cjs');

// Optional shards can run separately. Keep scripts serial within each process
// so browser timing assertions do not compete for CPU or fixed test ports.
(async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--list' && !arg.startsWith('--shard=')) || args.filter(arg => arg.startsWith('--shard=')).length > 1) {
    throw new Error('Usage: test-ui-audit.cjs [--shard=INDEX/TOTAL] [--list]');
  }
  const shard = args.find(arg => arg.startsWith('--shard='))?.slice(8) || '1/1';
  const selected = selectShard(scripts, shard);
  if (args.includes('--list')) { console.log(selected.join('\n')); return; }
  // Match production performance and test the exact artifact Pages will publish.
  const { preview } = await import('vite');
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  const results = [];
  try {
    const env = { ...process.env, XIANGQI_QA_URL: server.resolvedUrls.local[0] };
    for (const script of selected) {
      const start = Date.now();
      console.log(`::group::${script} (shard ${shard})`);
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [path.join(__dirname, script)], { env, stdio: 'inherit', timeout: 180_000, killSignal: 'SIGKILL' });
          child.once('error', reject);
          child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} exited with ${signal || code}`)));
        });
        results.push({ script, status: 'passed', seconds: (Date.now() - start) / 1000 });
      } catch (error) {
        console.error(error);
        results.push({ script, status: 'failed', seconds: (Date.now() - start) / 1000 });
      } finally { console.log('::endgroup::'); }
    }
  } finally {
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    fs.mkdirSync(path.join(__dirname, '../.cache'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, `../.cache/ui-audit-${shard.replace('/', '-of-')}.json`), JSON.stringify(results, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Browser audit ${shard}\n\n| Script | Result | Seconds |\n| --- | --- | ---: |\n` + results.map(r => `| ${r.script} | ${r.status} | ${r.seconds.toFixed(1)} |`).join('\n') + '\n');
    }
  }
  if (results.some(result => result.status === 'failed')) throw new Error('Browser audit failed; see per-script results above');
})().catch(error => { console.error(error); process.exitCode = 1; });
