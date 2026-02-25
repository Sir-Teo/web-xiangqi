"use strict";

(function() {
  function wasmThreadsSupported() {
    try {
      const source = Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
      if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") return false;
      if (!WebAssembly.validate(source)) return false;
      if (typeof SharedArrayBuffer !== "function") return false;
      if (typeof Atomics !== "object") return false;
      const mem = new WebAssembly.Memory({ shared: true, initial: 8, maximum: 16 });
      if (!(mem.buffer instanceof SharedArrayBuffer)) return false;
      if (typeof window !== "undefined" && typeof window.postMessage === "function") {
        try { window.postMessage(mem, "*"); } catch (_) { return false; }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function isNode() {
    return typeof process !== "undefined" &&
      process.versions &&
      process.versions.node;
  }

  function isWorker() {
    return typeof self !== "undefined" &&
      typeof importScripts === "function" &&
      (typeof document === "undefined");
  }

  function dirname(p) {
    return p.replace(/[\\/][^\\/]*$/, "");
  }

  async function readBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (isNode()) {
      const fs = require("fs");
      return fs.readFileSync(input);
    }
    const res = await fetch(input);
    if (!res.ok) throw new Error("Failed to fetch NNUE: " + input);
    return new Uint8Array(await res.arrayBuffer());
  }

  function defaultBasePath() {
    if (isNode()) return __dirname;
    if (typeof self !== "undefined" && self.location) {
      const url = self.location.href.split("#")[0];
      return dirname(url);
    }
    return ".";
  }

  function joinPath(base, file) {
    if (isNode()) {
      const path = require("path");
      return path.join(base, file);
    }
    return String(base).replace(/\/+$/, "") + "/" + file;
  }

  function resolveVariant(opts) {
    const requested = (opts && opts.variant) || "auto";
    if (requested === "threaded" || requested === "single") return requested;
    if (isNode()) return "threaded";
    return wasmThreadsSupported() ? "threaded" : "single";
  }

  function coreMeta(variant) {
    return variant === "single"
      ? { jsFile: "pikafish-core-single.js", globalName: "PikafishCoreSingle" }
      : { jsFile: "pikafish-core.js", globalName: "PikafishCore" };
  }

  function clampInt(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, Math.trunc(v)));
  }

  function detectHardwareThreads() {
    if (isNode()) {
      try {
        const os = require("os");
        return Math.max(1, os.cpus().length || 1);
      } catch (_) {
        return 1;
      }
    }
    if (typeof navigator !== "undefined" && Number.isFinite(navigator.hardwareConcurrency)) {
      return Math.max(1, Math.trunc(navigator.hardwareConcurrency));
    }
    return 1;
  }

  function detectMemoryHintMB() {
    if (isNode()) {
      try {
        const os = require("os");
        return Math.max(256, Math.trunc(os.totalmem() / (1024 * 1024)));
      } catch (_) {
        return 0;
      }
    }
    if (typeof navigator !== "undefined" && Number.isFinite(navigator.deviceMemory)) {
      return Math.max(256, Math.trunc(navigator.deviceMemory * 1024));
    }
    return 0;
  }

  function recommendedHashMB(opts) {
    if (opts && opts.autoHashMB === false) return null;
    if (opts && Number.isFinite(Number(opts.hashMB))) {
      return clampInt(Number(opts.hashMB), 1, 4096);
    }
    const memMB = detectMemoryHintMB();
    if (!memMB) return 64;
    // Conservative default: keep hash useful without pressuring browser memory.
    return clampInt(Math.floor(memMB / 16), 32, 128);
  }

  function recommendedThreads(opts, variant) {
    if (variant !== "threaded") return 1;
    const maxAutoThreads = clampInt((opts && opts.maxAutoThreads) || 4, 1, 64);
    if (opts && Number.isFinite(Number(opts.threads))) {
      return clampInt(Number(opts.threads), 1, maxAutoThreads);
    }
    return clampInt(detectHardwareThreads(), 1, maxAutoThreads);
  }

  function getCoreFactory(opts) {
    if (opts && opts.coreFactory) return opts.coreFactory;
    const meta = coreMeta(opts.variant);
    if (isNode()) {
      const path = require("path");
      const corePath = (opts && opts.coreJsPath) || path.join(opts.basePath || __dirname, meta.jsFile);
      return require(corePath);
    }
    if (typeof self !== "undefined" && typeof self[meta.globalName] !== "undefined") return self[meta.globalName];
    throw new Error(meta.globalName + " not found. Load " + meta.jsFile + " first.");
  }

  async function createEngine(opts) {
    opts = opts || {};
    const variant = resolveVariant(opts);
    const basePath = opts.basePath || defaultBasePath();
    const coreFactory = getCoreFactory({ ...opts, basePath, variant });
    const listeners = new Set();
    const pending = [];
    let searching = false;
    let quitting = false;
    let mod;

    function emit(line) {
      for (const fn of listeners) fn(line);
    }

    function maybeFlush() {
      if (searching || !pending.length) return;
      while (pending.length && !searching) {
        const cmd = pending.shift();
        rawSend(cmd);
      }
    }

    function onLine(line) {
      emit(line);
      if (/^bestmove\b/.test(line)) {
        searching = false;
        maybeFlush();
      }
    }

    const meta = coreMeta(variant);
    mod = await coreFactory({
      listener: onLine,
      // In browser workers, Emscripten pthread workers need to load the core
      // runtime script, not this wrapper script.
      mainScriptUrlOrBlob: !isNode() ? joinPath(basePath, meta.jsFile) : undefined,
      locateFile: function(file) {
        if (file.endsWith(".wasm") || file.endsWith(".worker.js")) {
          return joinPath(basePath, file);
        }
        return file;
      }
    });

    async function loadNNUE(nnueSource) {
      const target = "/pikafish.nnue";
      const bytes = await readBytes(nnueSource || opts.nnuePath || joinPath(basePath, "pikafish.nnue"));
      try {
        mod.FS.unlink(target);
      } catch (_) {}
      mod.FS.writeFile(target, bytes);
      rawSend("setoption name EvalFile value " + target);
      return target;
    }

    function rawSend(cmd) {
      mod.ccall("command", null, ["string"], [cmd]);
      if (/^quit\b/.test(cmd)) quitting = true;
    }

    function postMessage(cmd) {
      cmd = String(cmd).trim();
      if (!cmd) return;
      if (/^go\b/.test(cmd)) {
        searching = true;
        rawSend(cmd);
        return;
      }
      if (searching && (/^setoption\b/.test(cmd) || /^position\b/.test(cmd) || /^ucinewgame\b/.test(cmd))) {
        pending.push(cmd);
        return;
      }
      rawSend(cmd);
    }

    if (opts.autoTune !== false) {
      const threads = recommendedThreads(opts, variant);
      const hashMB = recommendedHashMB(opts);
      if (threads >= 1) rawSend("setoption name Threads value " + threads);
      if (hashMB && hashMB >= 1) rawSend("setoption name Hash value " + hashMB);
    }

    if (opts.autoLoadNNUE !== false) {
      await loadNNUE(opts.nnuePath);
    }

    return {
      variant,
      postMessage,
      loadNNUE,
      addMessageListener(fn) { listeners.add(fn); },
      removeMessageListener(fn) { listeners.delete(fn); },
      async terminate() {
        if (!quitting) {
          try { postMessage("quit"); } catch (_) {}
        }
        try {
          if (typeof mod.terminate === "function") mod.terminate();
        } catch (_) {}
      }
    };
  }

  async function createWorkerEngine(opts) {
    if (isNode()) {
      throw new Error("createWorkerEngine() is browser-only");
    }
    if (typeof Worker !== "function") {
      throw new Error("Web Workers are not supported in this environment");
    }

    opts = opts || {};
    const basePath = opts.basePath || defaultBasePath();
    const wrapperScript = opts.workerScript || joinPath(basePath, "pikafish.js");
    const requestedVariant = opts.variant || "auto";
    const bootstrapVariant = resolveVariant({ variant: requestedVariant });
    const coreScript = opts.coreScript || joinPath(basePath, coreMeta(bootstrapVariant).jsFile);
    const coreScripts = opts.coreScripts || null;

    const listeners = new Set();
    let worker;
    let terminated = false;
    let activeVariant = bootstrapVariant;

    function emit(line) {
      for (const fn of listeners) fn(line);
    }

    const started = await new Promise((resolve, reject) => {
      let settled = false;
      let timer;

      function cleanup() {
        clearTimeout(timer);
      }

      worker = new Worker(wrapperScript);

      worker.onmessage = function(event) {
        const data = event.data;
        if (data && typeof data === "object" && data.type) {
          if (data.type === "inited") {
            activeVariant = data.variant || activeVariant;
            settled = true;
            cleanup();
            resolve();
            return;
          }
          if (data.type === "error") {
            const err = new Error(data.message || "Worker engine error");
            if (!settled) {
              settled = true;
              cleanup();
              reject(err);
            } else {
              emit("[worker-error] " + err.message);
            }
            return;
          }
          return;
        }
        emit(String(data));
      };

      worker.onerror = function(err) {
        const e = err && err.error ? err.error : new Error(err.message || "Worker error");
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        } else {
          emit("[worker-error] " + e.message);
        }
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { worker.terminate(); } catch (_) {}
        reject(new Error("Timed out initializing Pikafish worker"));
      }, opts.initTimeoutMs || 60000);

      worker.postMessage({
        type: "init",
        basePath,
        nnuePath: opts.nnuePath || joinPath(basePath, "pikafish.nnue"),
        variant: requestedVariant,
        bootstrapVariant,
        autoLoadNNUE: opts.autoLoadNNUE !== false,
        autoTune: opts.autoTune !== false,
        maxAutoThreads: opts.maxAutoThreads,
        threads: opts.threads,
        autoHashMB: opts.autoHashMB,
        hashMB: opts.hashMB,
        coreScript,
        coreScripts
      });
    });

    void started;

    return {
      get variant() { return activeVariant; },
      postMessage(cmd) {
        if (terminated) throw new Error("Worker engine already terminated");
        worker.postMessage(String(cmd));
      },
      async loadNNUE(nnuePath) {
        if (terminated) throw new Error("Worker engine already terminated");
        worker.postMessage({ type: "loadNNUE", path: nnuePath || joinPath(basePath, "pikafish.nnue") });
      },
      addMessageListener(fn) { listeners.add(fn); },
      removeMessageListener(fn) { listeners.delete(fn); },
      async terminate() {
        if (terminated) return;
        terminated = true;
        try { worker.postMessage({ type: "terminate" }); } catch (_) {}
        try { worker.terminate(); } catch (_) {}
      }
    };
  }

  createEngine.wasmThreadsSupported = wasmThreadsSupported;
  createEngine.createWorkerEngine = createWorkerEngine;

  if (isNode()) {
    module.exports = createEngine;
    module.exports.createWorkerEngine = createWorkerEngine;
    module.exports.wasmThreadsSupported = wasmThreadsSupported;
    return;
  }

    if (isWorker()) {
      let enginePromise = null;
      let basePathOverride = null;
      let nnuePathOverride = null;
      let variantOverride = "auto";
      let autoLoadNNUEOverride = true;
      let autoTuneOverride = true;
      let maxAutoThreadsOverride = undefined;
      let threadsOverride = undefined;
      let autoHashMBOverride = true;
      let hashMBOverride = undefined;
      let forwardAttached = false;

    function ensureEngine() {
      if (!enginePromise) {
        enginePromise = createEngine({
            basePath: basePathOverride || defaultBasePath(),
            nnuePath: nnuePathOverride || null,
            variant: variantOverride,
            autoLoadNNUE: autoLoadNNUEOverride,
            autoTune: autoTuneOverride,
            maxAutoThreads: maxAutoThreadsOverride,
            threads: threadsOverride,
            autoHashMB: autoHashMBOverride,
            hashMB: hashMBOverride
          });
        }
        return enginePromise;
    }

    function attachForwarder(engine) {
      if (forwardAttached) return;
      forwardAttached = true;
      engine.addMessageListener(function(line) {
        self.postMessage(String(line));
      });
    }

    self.onmessage = async function(event) {
      try {
        const data = event.data;
        if (data && typeof data === "object" && data.type === "init") {
          if (Array.isArray(data.coreScripts) && data.coreScripts.length) {
            importScripts.apply(null, data.coreScripts);
          } else if (data.coreScript) {
            importScripts(data.coreScript);
          }
          basePathOverride = data.basePath || basePathOverride;
          nnuePathOverride = data.nnuePath || nnuePathOverride;
          variantOverride = data.bootstrapVariant || data.variant || variantOverride;
          autoLoadNNUEOverride = data.autoLoadNNUE !== false;
          autoTuneOverride = data.autoTune !== false;
          maxAutoThreadsOverride = data.maxAutoThreads;
          threadsOverride = data.threads;
          autoHashMBOverride = data.autoHashMB !== false;
          hashMBOverride = data.hashMB;
          const engine = await ensureEngine();
          attachForwarder(engine);
          self.postMessage({ type: "inited", variant: engine.variant });
          return;
        }

        const engine = await ensureEngine();
        attachForwarder(engine);

        if (data && typeof data === "object" && data.type === "terminate") {
          await engine.terminate();
          self.postMessage({ type: "terminated" });
          try { self.close(); } catch (_) {}
          return;
        }

        if (data && typeof data === "object" && data.type === "loadNNUE") {
          await engine.loadNNUE(data.path);
          self.postMessage({ type: "nnueLoaded" });
          return;
        }

        engine.postMessage(String(data));
      } catch (e) {
        self.postMessage({ type: "error", message: (e && e.stack) ? e.stack : String(e) });
      }
    };
    self.Pikafish = createEngine;
    return;
  }

  self.Pikafish = createEngine;
})();
