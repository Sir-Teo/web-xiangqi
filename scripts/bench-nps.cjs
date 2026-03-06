#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { performance } = require("perf_hooks");

const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || "");
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key === "json" || key === "quiet") {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function safeInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, safeInt(v, min)));
}

function getGitRef(rootDir) {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: rootDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
  } catch (_) {
    return "";
  }
}

function median(values) {
  if (!values.length) return 0;
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : ((arr[mid - 1] + arr[mid]) / 2);
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function formatPct(delta) {
  if (!Number.isFinite(delta)) return "n/a";
  const pct = delta * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function coreJsFileForVariant(variant) {
  switch (String(variant || "").trim()) {
    case "single":
      return "pikafish-core-single.js";
    case "single-simd":
      return "pikafish-core-single-simd.js";
    case "threaded":
      return "pikafish-core.js";
    case "threaded-simd":
      return "pikafish-core-simd.js";
    default:
      return "pikafish-core-simd.js";
  }
}

function parseInfoLine(line) {
  const text = String(line || "");
  if (!/^info depth\s+/i.test(text)) return null;
  const depth = Number((text.match(/\bdepth\s+(\d+)/i) || [])[1] || 0);
  const nps = Number((text.match(/\bnps\s+(\d+)/i) || [])[1] || 0);
  const nodes = Number((text.match(/\bnodes\s+(\d+)/i) || [])[1] || 0);
  const time = Number((text.match(/\btime\s+(\d+)/i) || [])[1] || 0);
  const multipv = Number((text.match(/\bmultipv\s+(\d+)/i) || [])[1] || 1);
  return { depth, nps, nodes, time, multipv };
}

function waitForLiveLine(engine, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for " + label));
    }, timeoutMs);

    function onLine(line) {
      let ok = false;
      try { ok = !!predicate(String(line)); } catch (e) {
        cleanup();
        reject(e);
        return;
      }
      if (!ok) return;
      cleanup();
      resolve(String(line));
    }

    function cleanup() {
      clearTimeout(timer);
      try { engine.removeMessageListener(onLine); } catch (_) {}
    }

    engine.addMessageListener(onLine);
  });
}

async function runSearch(engine, cfg, state) {
  state.activeRun = { bestmove: "", maxInfo: null };
  try {
    engine.postMessage("ucinewgame");
    try { engine.setOption("Clear Hash"); } catch (_) {}
    await engine.isReady({ timeoutMs: cfg.timeoutMs });
    engine.postMessage("position fen " + cfg.fen);
    const bestmoveP = waitForLiveLine(engine, (line) => /^bestmove\s+/i.test(line), cfg.timeoutMs, "bestmove");
    const t0 = performance.now();
    engine.postMessage("go depth " + cfg.depth);
    const bestLine = await bestmoveP;
    const wallMs = performance.now() - t0;
    const bestmove = (bestLine.match(/^bestmove\s+(\S+)/i) || [])[1] || state.activeRun.bestmove || "";
    const info = state.activeRun.maxInfo || null;
    return {
      wallMs,
      bestmove,
      info,
      nps: info && Number.isFinite(info.nps) ? info.nps : 0,
      nodes: info && Number.isFinite(info.nodes) ? info.nodes : 0,
      time: info && Number.isFinite(info.time) ? info.time : 0,
      depth: info && Number.isFinite(info.depth) ? info.depth : 0
    };
  } finally {
    state.activeRun = null;
  }
}

function printSummary(snapshot, compareTo) {
  console.log("");
  console.log("Benchmark Summary");
  console.log("  label:          " + (snapshot.label || ""));
  console.log("  requested:      " + snapshot.requestedVariant);
  console.log("  resolved:       " + snapshot.resolvedVariant);
  console.log("  depth:          " + snapshot.depth);
  console.log("  repeats:        " + snapshot.repeats + " (warmup " + snapshot.warmup + ")");
  console.log("  threads/hash:   " + snapshot.threads + " / " + snapshot.hashMB + " MB");
  console.log("  cold start ms:  " + Math.round(snapshot.coldStartMs));
  console.log("  avg wall ms:    " + Math.round(snapshot.avgWallMs));
  console.log("  median wall ms: " + Math.round(snapshot.medianWallMs));
  console.log("  avg nps:        " + Math.round(snapshot.avgNps));
  console.log("  median nps:     " + Math.round(snapshot.medianNps));
  console.log("  bestmove:       " + (snapshot.lastBestmove || ""));
  if (!compareTo) return;

  const npsDelta = compareTo.avgNps > 0 ? ((snapshot.avgNps - compareTo.avgNps) / compareTo.avgNps) : NaN;
  const wallDelta = compareTo.avgWallMs > 0 ? ((snapshot.avgWallMs - compareTo.avgWallMs) / compareTo.avgWallMs) : NaN;
  const coldDelta = compareTo.coldStartMs > 0 ? ((snapshot.coldStartMs - compareTo.coldStartMs) / compareTo.coldStartMs) : NaN;

  console.log("");
  console.log("Comparison vs " + (compareTo.label || compareTo.createdAt));
  console.log("  avg nps delta:  " + formatPct(npsDelta) + " (" + Math.round(compareTo.avgNps) + " -> " + Math.round(snapshot.avgNps) + ")");
  console.log("  avg wall delta: " + formatPct(wallDelta) + " (" + Math.round(compareTo.avgWallMs) + " -> " + Math.round(snapshot.avgWallMs) + ")");
  console.log("  cold start:     " + formatPct(coldDelta) + " (" + Math.round(compareTo.coldStartMs) + " -> " + Math.round(snapshot.coldStartMs) + ")");
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const distDir = path.resolve(rootDir, "dist");
  const args = parseArgs(process.argv.slice(2));

  const cpuCount = Math.max(1, (os.cpus() || []).length || 1);
  const cfg = {
    variant: String(args.variant || process.env.PIKAFISH_BENCH_VARIANT || "threaded-simd").trim(),
    depth: clampInt(args.depth || process.env.PIKAFISH_BENCH_DEPTH || 8, 1, 64),
    repeats: clampInt(args.repeats || process.env.PIKAFISH_BENCH_REPEATS || 3, 1, 20),
    warmup: clampInt(args.warmup || process.env.PIKAFISH_BENCH_WARMUP || 1, 0, 10),
    hashMB: clampInt(args.hash || process.env.PIKAFISH_BENCH_HASH || 256, 1, 4096),
    threads: clampInt(args.threads || process.env.PIKAFISH_BENCH_THREADS || Math.max(1, cpuCount - 1), 1, 64),
    timeoutMs: clampInt(args.timeout || process.env.PIKAFISH_BENCH_TIMEOUT_MS || 120000, 1000, 600000),
    outPath: args.out ? path.resolve(String(args.out)) : "",
    comparePath: args.compare ? path.resolve(String(args.compare)) : "",
    label: String(args.label || process.env.PIKAFISH_BENCH_LABEL || "").trim(),
    fen: String(args.fen || process.env.PIKAFISH_BENCH_FEN || START_FEN).trim(),
    json: !!args.json,
    quiet: !!args.quiet
  };

  if (!fs.existsSync(path.join(distDir, "pikafish.js"))) {
    throw new Error("dist/pikafish.js not found. Build first.");
  }

  const wrapperSrcPath = path.join(distDir, "pikafish.js");
  const wrapperCjsPath = path.join(os.tmpdir(), "pikafish-bench-wrapper.cjs");
  const coreJsSrcPath = path.join(distDir, coreJsFileForVariant(cfg.variant));
  const coreFactoryCjsPath = path.join(os.tmpdir(), "pikafish-bench-core.cjs");
  fs.copyFileSync(wrapperSrcPath, wrapperCjsPath);
  fs.copyFileSync(coreJsSrcPath, coreFactoryCjsPath);
  const createPikafish = require(wrapperCjsPath);
  const coreFactory = require(coreFactoryCjsPath);
  const state = { activeRun: null };
  let engine = null;

  const snapshot = {
    createdAt: new Date().toISOString(),
    label: cfg.label || ("bench-" + cfg.variant + "-d" + cfg.depth),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount,
    gitRef: getGitRef(rootDir),
    distDir,
    requestedVariant: cfg.variant,
    resolvedVariant: "",
    depth: cfg.depth,
    repeats: cfg.repeats,
    warmup: cfg.warmup,
    hashMB: cfg.hashMB,
    threads: cfg.threads,
    timeoutMs: cfg.timeoutMs,
    coldStartMs: 0,
    runs: [],
    avgWallMs: 0,
    medianWallMs: 0,
    avgNps: 0,
    medianNps: 0,
    lastBestmove: ""
  };

  try {
    const initT0 = performance.now();
    engine = await createPikafish({
      basePath: distDir,
      nnuePath: path.join(distDir, "pikafish.nnue"),
      variant: cfg.variant,
      coreFactory,
      autoTune: false,
      lineHistoryMax: 200
    });

    const lineListener = (line) => {
      const text = String(line);
      const run = state.activeRun;
      if (!run) return;
      const info = parseInfoLine(text);
      if (info && info.multipv <= 1) {
        if (!run.maxInfo ||
            info.depth > run.maxInfo.depth ||
            (info.depth === run.maxInfo.depth && info.time >= run.maxInfo.time)) {
          run.maxInfo = info;
        }
      }
      const bm = text.match(/^bestmove\s+(\S+)/i);
      if (bm) run.bestmove = bm[1];
    };
    engine.addMessageListener(lineListener);

    await engine.uci({ timeoutMs: cfg.timeoutMs });
    try { engine.setOption("Hash", cfg.hashMB); } catch (_) {}
    try { engine.setOption("Threads", cfg.threads); } catch (_) {}
    try { engine.setOption("MultiPV", 1); } catch (_) {}
    try { engine.setOption("UCI_ShowWDL", "false"); } catch (_) {}
    try { engine.setOption("Ponder", "false"); } catch (_) {}
    await engine.isReady({ timeoutMs: cfg.timeoutMs });
    snapshot.coldStartMs = performance.now() - initT0;
    snapshot.resolvedVariant = String(engine.variant || cfg.variant);

    if (!cfg.quiet) {
      console.log("Benchmarking " + snapshot.resolvedVariant + " (requested " + cfg.variant + ")");
      console.log("depth=" + cfg.depth + " repeats=" + cfg.repeats + " warmup=" + cfg.warmup + " threads=" + cfg.threads + " hash=" + cfg.hashMB + "MB");
    }

    for (let i = 0; i < cfg.warmup; i++) {
      if (!cfg.quiet) console.log("warmup " + (i + 1) + "/" + cfg.warmup + "...");
      await runSearch(engine, cfg, state);
    }

    for (let i = 0; i < cfg.repeats; i++) {
      if (!cfg.quiet) console.log("run " + (i + 1) + "/" + cfg.repeats + "...");
      const out = await runSearch(engine, cfg, state);
      snapshot.runs.push({
        index: i + 1,
        wallMs: out.wallMs,
        nps: out.nps,
        nodes: out.nodes,
        time: out.time,
        depth: out.depth,
        bestmove: out.bestmove
      });
      snapshot.lastBestmove = out.bestmove || snapshot.lastBestmove;
      if (!cfg.quiet) {
        console.log(
          "  wall=" + Math.round(out.wallMs) + "ms" +
          " nps=" + Math.round(out.nps || 0) +
          " depth=" + (out.depth || 0) +
          " bestmove=" + (out.bestmove || "?")
        );
      }
    }

    const wallValues = snapshot.runs.map((r) => Number(r.wallMs) || 0);
    const npsValues = snapshot.runs.map((r) => Number(r.nps) || 0);
    snapshot.avgWallMs = avg(wallValues);
    snapshot.medianWallMs = median(wallValues);
    snapshot.avgNps = avg(npsValues);
    snapshot.medianNps = median(npsValues);

    let compareSnapshot = null;
    if (cfg.comparePath) {
      compareSnapshot = JSON.parse(fs.readFileSync(cfg.comparePath, "utf8"));
    }

    if (cfg.outPath) {
      fs.mkdirSync(path.dirname(cfg.outPath), { recursive: true });
      fs.writeFileSync(cfg.outPath, JSON.stringify(snapshot, null, 2) + "\n");
      if (!cfg.quiet) console.log("saved snapshot: " + cfg.outPath);
    }

    if (cfg.json) {
      console.log(JSON.stringify({ snapshot, compareTo: compareSnapshot || null }, null, 2));
    } else {
      printSummary(snapshot, compareSnapshot);
    }

    try { engine.removeMessageListener(lineListener); } catch (_) {}
  } finally {
    if (engine) {
      try { await engine.terminate(); } catch (_) {}
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
