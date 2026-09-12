#!/usr/bin/env node
"use strict";

/**
 * The shipped engine against what the wrapper assumes about it.
 *
 * This exists because of a failure nothing else in the pipeline could see.
 * `install-emsdk.sh` used `EMSDK_VERSION=latest`, so the Pages deploy compiled
 * the engine with whatever emsdk was current that morning. Emscripten 6.0.2
 * dropped `mainScriptUrlOrBlob` from INCOMING_MODULE_JS_API, and
 * `templates/pikafish.js` passes exactly that -- the module is constructed
 * inside a worker, where `document.currentScript` does not exist, so
 * Emscripten's own `_scriptName` is undefined and every pthread worker it
 * spawns becomes `new Worker(undefined)`. A 404, a thread pool whose load
 * dependency never clears, and a threaded core that answers `uci` and then
 * never answers `readyok`.
 *
 * Every existing gate missed it:
 *
 * - the changelog promises an error in *debug* builds, and this build sets
 *   ASSERTIONS=0, so the ignored key is silent;
 * - `test:smoke` and `test:parity` pass, because they run under Node, which
 *   never takes the worker path;
 * - the browser suite in ci.yml runs `PIKAFISH_BROWSER_VARIANT=single`, so it
 *   never loads a threaded core at all;
 * - and the deploy does not wait for ci.yml regardless.
 *
 * So this is a *static* check on the built artifact, which is what lets it run
 * everywhere the others cannot: no browser, no toolchain, no engine boot.
 * It is deliberately cheap enough to sit inside `npm run verify`, which the
 * deploy already runs before it publishes.
 *
 * It also enforces the coupling `docs/architecture.md` describes and nothing
 * checked: the thread pool baked into the artifact and
 * `ENGINE_PTHREAD_POOL_SIZE` in `analysisProfile.ts` "must move as one". A
 * source-only raise would let a tier ask for more threads than the shipped core
 * was built to hold, which hangs it in the same silent way.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** Mirrors `coreMeta` in templates/pikafish.js -- the wrapper's own table. */
const CORES = [
  { jsFile: "pikafish-core.js", globalName: "PikafishCore", threaded: true },
  { jsFile: "pikafish-core-simd.js", globalName: "PikafishCoreSimd", threaded: true },
  { jsFile: "pikafish-core-single.js", globalName: "PikafishCoreSingle", threaded: false },
  { jsFile: "pikafish-core-single-simd.js", globalName: "PikafishCoreSingleSimd", threaded: false },
];

const SHIPPED_DIRS = ["public", "dist"];

const failures = [];

function fail(message) {
  failures.push(message);
}

/** The pool the app believes the artifacts were built with. */
function poolSizeFromSource() {
  const source = fs.readFileSync(path.join(ROOT, "src/utils/analysisProfile.ts"), "utf8");
  const match = source.match(/export const ENGINE_PTHREAD_POOL_SIZE = (\d+);/);
  if (!match) {
    fail("Could not read ENGINE_PTHREAD_POOL_SIZE from src/utils/analysisProfile.ts");
    return null;
  }
  return Number(match[1]);
}

/** The most threads any device may ask for, from the same source of truth. */
function maxThreadsFromSource() {
  const source = fs.readFileSync(path.join(ROOT, "src/utils/analysisProfile.ts"), "utf8");
  const headroom = source.match(/export const ENGINE_THREAD_HEADROOM = (\d+);/);
  const pool = source.match(/export const ENGINE_PTHREAD_POOL_SIZE = (\d+);/);
  if (!headroom || !pool) return null;
  return Number(pool[1]) - Number(headroom[1]);
}

function checkCore(dir, core, expectedPool) {
  const file = path.join(ROOT, dir, core.jsFile);
  if (!fs.existsSync(file)) {
    // dist is built on demand; public is the shipped engine and must be there.
    if (dir === "public") fail(`${dir}/${core.jsFile} is missing`);
    return;
  }
  const source = fs.readFileSync(file, "utf8");
  const where = `${dir}/${core.jsFile}`;

  // The wrapper looks the module up by this exact name.
  if (!new RegExp(`var ${core.globalName}\\s*=`).test(source)) {
    fail(`${where}: does not define ${core.globalName}, which templates/pikafish.js looks up`);
  }

  // -sEXPORTED_RUNTIME_METHODS / -sEXPORTED_FUNCTIONS, which the wrapper calls.
  for (const symbol of ["locateFile", "ccall", "_command"]) {
    if (!source.includes(symbol)) {
      fail(`${where}: ${symbol} is absent; the wrapper needs it to drive the engine`);
    }
  }

  const poolMatch = source.match(/pthreadPoolSize\s*=\s*(\d+)/);

  if (!core.threaded) {
    // The non-isolated fallback must be genuinely single-threaded: it is what
    // loads where SharedArrayBuffer is unavailable, including GitHub Pages.
    if (poolMatch) {
      fail(`${where}: single-threaded core carries a pthread pool (${poolMatch[0]})`);
    }
    return;
  }

  // The one that was silently dropped. Without it the pool spawns workers from
  // `undefined` and the engine never becomes ready.
  if (!/Module\[["']mainScriptUrlOrBlob["']\]/.test(source)) {
    fail(
      `${where}: does not honour Module["mainScriptUrlOrBlob"]. ` +
      `templates/pikafish.js passes it so pthread workers boot from the core rather than from ` +
      `an undefined _scriptName. Emscripten 6.0.2 removed it -- check EMSDK_VERSION in ` +
      `scripts/install-emsdk.sh, and see docs/architecture.md.`
    );
  }

  if (!poolMatch) {
    fail(`${where}: no pthread pool found in a threaded core`);
    return;
  }

  const built = Number(poolMatch[1]);
  if (expectedPool !== null && built !== expectedPool) {
    fail(
      `${where}: built with pool ${built}, but ENGINE_PTHREAD_POOL_SIZE is ${expectedPool}. ` +
      `These must move together: a source-only raise lets a tier ask for more threads than ` +
      `the shipped core holds, and the engine then hangs without erroring. ` +
      `Rebuild with WASM_PTHREAD_POOL_SIZE=${expectedPool} npm run build.`
    );
  }
}

function main() {
  const expectedPool = poolSizeFromSource();
  const maxThreads = maxThreadsFromSource();

  if (expectedPool !== null && maxThreads !== null && maxThreads >= expectedPool) {
    fail(
      `MAX_ENGINE_THREADS (${maxThreads}) is not below ENGINE_PTHREAD_POOL_SIZE (${expectedPool}). ` +
      `Asking for the whole pool leaves nothing for the threads Pikafish wants for itself.`
    );
  }

  const buildModes = new Map();
  for (const dir of SHIPPED_DIRS) {
    const file = path.join(ROOT, dir, 'pikafish.js');
    if (fs.existsSync(file)) {
      const markers = [...fs.readFileSync(file, 'utf8').matchAll(/^  const BUILD_HAS_SIMD = (true|false);$/gm)];
      if (markers.length !== 1) fail(`${dir}/pikafish.js must declare one BUILD_HAS_SIMD setting`);
      else buildModes.set(dir, markers[0][1] === 'true');
    }
    for (const core of CORES) {
      if (buildModes.get(dir) === false && core.jsFile.includes('-simd.')) {
        for (const ext of ['js', 'wasm', 'worker.js']) {
          const skipped = core.jsFile.replace(/\.js$/, '.' + ext);
          if (fs.existsSync(path.join(ROOT, dir, skipped))) fail(`${dir}/${skipped} is stale: the wrapper declares a scalar-only build`);
        }
      } else checkCore(dir, core, expectedPool);
    }
  }
  if (buildModes.size === 2 && buildModes.get('public') !== buildModes.get('dist')) {
    fail('public and dist wrappers disagree about SIMD build availability');
  }

  // The wrapper carries its own copy, because it clamps a caller's explicit
  // thread count and is a published helper -- `Pikafish.createWorkerEngine` is
  // in the README, so someone outside this repo can ask for 16 threads.
  const wrapper = fs.readFileSync(path.join(ROOT, "templates/pikafish.js"), "utf8");
  const wrapperPool = wrapper.match(/const WASM_PTHREAD_POOL_SIZE = (\d+);/);
  if (!wrapperPool) {
    fail("Could not read WASM_PTHREAD_POOL_SIZE from templates/pikafish.js");
  } else if (expectedPool !== null && Number(wrapperPool[1]) !== expectedPool) {
    fail(
      `templates/pikafish.js believes the pool is ${wrapperPool[1]}, but ` +
      `ENGINE_PTHREAD_POOL_SIZE is ${expectedPool}. The wrapper clamps a caller's ` +
      `thread count against its copy, so a stale one lets a browser ask past what ` +
      `the shipped core holds -- which hangs it without erroring.`
    );
  }

  // The shipped copies match the template except for the generated SIMD flag.
  // `build-pikafish.sh` writes them into `public/` and `dist/`, so editing the template without rebuilding
  // leaves the app running the old wrapper -- which is not a subtle difference
  // when the edit is a thread clamp. Nothing checked this, and the copies were
  // 35 lines behind when it was added.
  for (const dir of SHIPPED_DIRS) {
    const shipped = path.join(ROOT, dir, "pikafish.js");
    if (!fs.existsSync(shipped)) {
      if (dir === "public") fail(`${dir}/pikafish.js is missing`);
      continue;
    }
    const normalized = fs.readFileSync(shipped, "utf8").replace(/^  const BUILD_HAS_SIMD = false;$/m, '  const BUILD_HAS_SIMD = true;');
    if (normalized !== wrapper) {
      fail(
        `${dir}/pikafish.js does not match templates/pikafish.js apart from its build flag. The build writes the ` +
        `template into place, so this one is stale and it is what the app actually loads. ` +
        `Rerun \`npm run build\` with the intended WASM_BUILD_SIMD setting.`
      );
    }
  }

  // The build script's default has to agree too, or a plain `npm run build`
  // silently produces artifacts the app will over-ask.
  const buildScript = fs.readFileSync(path.join(ROOT, "scripts/build-pikafish.sh"), "utf8");
  const buildDefault = buildScript.match(/WASM_PTHREAD_POOL_SIZE="\$\{WASM_PTHREAD_POOL_SIZE:-(\d+)\}"/);
  if (!buildDefault) {
    fail("Could not read the WASM_PTHREAD_POOL_SIZE default from scripts/build-pikafish.sh");
  } else if (expectedPool !== null && Number(buildDefault[1]) !== expectedPool) {
    fail(
      `scripts/build-pikafish.sh defaults to pool ${buildDefault[1]}, but ` +
      `ENGINE_PTHREAD_POOL_SIZE is ${expectedPool}. A plain \`npm run build\` would produce ` +
      `artifacts the app over-asks.`
    );
  }

  if (failures.length) {
    console.error("Engine contract check failed:\n");
    for (const message of failures) console.error(`  - ${message}\n`);
    process.exit(1);
  }

  console.log(
    `Engine contract check passed (${buildModes.get('public') === false ? 2 : CORES.length} cores, pool ${expectedPool}, ` +
    `app max ask ${maxThreads}, wrapper agrees).`
  );
}

main();
