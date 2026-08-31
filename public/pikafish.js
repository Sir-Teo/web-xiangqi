"use strict";

(function() {
  let wasmThreadsSupportCache;
  let wasmSIMDSupportCache;
  let hardwareThreadsCache;
  let memoryHintMBCache;

  function wasmThreadsSupported() {
    if (typeof wasmThreadsSupportCache === "boolean") return wasmThreadsSupportCache;
    try {
      const source = Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
      if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") return (wasmThreadsSupportCache = false);
      if (!WebAssembly.validate(source)) return (wasmThreadsSupportCache = false);
      if (typeof SharedArrayBuffer !== "function") return (wasmThreadsSupportCache = false);
      if (typeof Atomics !== "object") return (wasmThreadsSupportCache = false);
      const mem = new WebAssembly.Memory({ shared: true, initial: 8, maximum: 16 });
      if (!(mem.buffer instanceof SharedArrayBuffer)) return (wasmThreadsSupportCache = false);
      if (typeof window !== "undefined" && typeof window.postMessage === "function") {
        try { window.postMessage(mem, "*"); } catch (_) { return (wasmThreadsSupportCache = false); }
      }
      return (wasmThreadsSupportCache = true);
    } catch (_) {
      return (wasmThreadsSupportCache = false);
    }
  }

  function wasmSIMDSupported() {
    if (typeof wasmSIMDSupportCache === "boolean") return wasmSIMDSupportCache;
    try {
      if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") return (wasmSIMDSupportCache = false);
      // Minimal module using the v128 value type. Validation fails when SIMD is unsupported.
      return (wasmSIMDSupportCache = WebAssembly.validate(Uint8Array.of(
        0x00,0x61,0x73,0x6d, 0x01,0x00,0x00,0x00,
        0x01,0x05, 0x01,0x60,0x00,0x01,0x7b
      )));
    } catch (_) {
      return (wasmSIMDSupportCache = false);
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

  function toUint8Array(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new Error("Expected Uint8Array, ArrayBuffer, or TypedArray view");
  }

  function linePredicate(matcher) {
    if (typeof matcher === "function") return matcher;
    if (matcher instanceof RegExp) return function(line) { return matcher.test(line); };
    return function(line) { return line === String(matcher); };
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
    const requested = String((opts && opts.variant) || "auto").trim();
    const simdOK = (opts && opts.allowSIMD === false) ? false : wasmSIMDSupported();
    const threadOK = isNode() ? true : wasmThreadsSupported();

    if (requested === "threaded-simd") {
      if (!threadOK) return simdOK ? "single-simd" : "single";
      return simdOK ? "threaded-simd" : "threaded";
    }
    if (requested === "single-simd") return simdOK ? "single-simd" : "single";
    if (requested === "threaded") {
      if (!threadOK) return simdOK ? "single-simd" : "single";
      return simdOK ? "threaded-simd" : "threaded";
    }
    if (requested === "single") return simdOK ? "single-simd" : "single";

    if (threadOK) return simdOK ? "threaded-simd" : "threaded";
    return simdOK ? "single-simd" : "single";
  }

  function coreMeta(variant) {
    switch (variant) {
      case "single":
        return { jsFile: "pikafish-core-single.js", globalName: "PikafishCoreSingle" };
      case "single-simd":
        return { jsFile: "pikafish-core-single-simd.js", globalName: "PikafishCoreSingleSimd" };
      case "threaded-simd":
        return { jsFile: "pikafish-core-simd.js", globalName: "PikafishCoreSimd" };
      case "threaded":
      default:
        return { jsFile: "pikafish-core.js", globalName: "PikafishCore" };
    }
  }

  function isThreadedVariant(variant) {
    return String(variant || "").indexOf("threaded") === 0;
  }

  function clampInt(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.min(max, Math.max(min, Math.trunc(v)));
  }

  function createLineHistory(limit) {
    const capacity = clampInt(limit, 1, 20000);
    const ring = new Array(capacity);
    let size = 0;
    let head = 0;

    function push(line) {
      if (size < capacity) {
        ring[size++] = line;
        return;
      }
      ring[head] = line;
      head = (head + 1) % capacity;
    }

    function find(pred) {
      const start = size === capacity ? head : 0;
      for (let i = 0; i < size; i++) {
        const line = ring[(start + i) % capacity];
        if (pred(line)) return line;
      }
      return null;
    }

    return { push, find };
  }

  function detectHardwareThreads() {
    if (Number.isFinite(hardwareThreadsCache) && hardwareThreadsCache >= 1) {
      return hardwareThreadsCache;
    }
    if (isNode()) {
      try {
        const os = require("os");
        hardwareThreadsCache = Math.max(1, os.cpus().length || 1);
        return hardwareThreadsCache;
      } catch (_) {
        hardwareThreadsCache = 1;
        return hardwareThreadsCache;
      }
    }
    if (typeof navigator !== "undefined" && Number.isFinite(navigator.hardwareConcurrency)) {
      hardwareThreadsCache = Math.max(1, Math.trunc(navigator.hardwareConcurrency));
      return hardwareThreadsCache;
    }
    hardwareThreadsCache = 1;
    return hardwareThreadsCache;
  }

  function detectMemoryHintMB() {
    if (Number.isFinite(memoryHintMBCache) && memoryHintMBCache >= 0) {
      return memoryHintMBCache;
    }
    if (isNode()) {
      try {
        const os = require("os");
        memoryHintMBCache = Math.max(256, Math.trunc(os.totalmem() / (1024 * 1024)));
        return memoryHintMBCache;
      } catch (_) {
        memoryHintMBCache = 0;
        return memoryHintMBCache;
      }
    }
    if (typeof navigator !== "undefined" && Number.isFinite(navigator.deviceMemory)) {
      memoryHintMBCache = Math.max(256, Math.trunc(navigator.deviceMemory * 1024));
      return memoryHintMBCache;
    }
    memoryHintMBCache = 0;
    return memoryHintMBCache;
  }

  function recommendedHashMB(opts) {
    if (opts && opts.autoHashMB === false) return null;
    if (opts && Number.isFinite(Number(opts.hashMB))) {
      return clampInt(Number(opts.hashMB), 1, 4096);
    }
    const memMB = detectMemoryHintMB();
    if (!memMB) return 64;
    // Keep defaults browser-safe while allowing larger desktop caches.
    return clampInt(Math.floor(memMB / 16), 32, 256);
  }

  /**
   * The pthread pool the shipped threaded cores are built with.
   *
   * Mirrors `WASM_PTHREAD_POOL_SIZE` in `scripts/build-pikafish.sh`, and
   * `scripts/test-engine-contract.cjs` fails if the two drift apart -- because
   * being wrong about it is not a small error. In a browser the engine runs
   * inside a worker, so asking for more search threads than the pool holds
   * blocks the calling thread in `pthread_create`: the engine does not error,
   * it simply never answers `readyok`.
   *
   * Node is not constrained by this and is deliberately not clamped. The pool
   * is a browser-worker concept; the same artifacts run 17 threads happily
   * under Node, which is what `npm run bench:nps` does.
   */
  const WASM_PTHREAD_POOL_SIZE = 12;

  /**
   * The most a browser may ask for, kept clear of the pool rather than equal to
   * it -- Pikafish wants a thread for its own bookkeeping, and the failure mode
   * for being one over is the silent hang above rather than an error.
   */
  const MAX_BROWSER_THREADS = WASM_PTHREAD_POOL_SIZE - 4;

  function recommendedThreads(opts, variant) {
    if (!isThreadedVariant(variant)) return 1;
    // An explicit ask is honoured, but not past what the core can hand out.
    // This is a published helper -- `Pikafish.createWorkerEngine` is in the
    // README -- so a caller passing 16 would otherwise get a worker that loads,
    // answers `uci`, and never becomes ready, with nothing to read.
    const ceiling = isNode() ? 64 : MAX_BROWSER_THREADS;
    if (opts && Number.isFinite(Number(opts.threads))) {
      return clampInt(Number(opts.threads), 1, ceiling);
    }
    // The browser default was 4 because the pool was 4. It tracks the pool now.
    const defaultMaxThreads = isNode() ? 8 : MAX_BROWSER_THREADS;
    const maxAutoThreads = clampInt((opts && opts.maxAutoThreads) || defaultMaxThreads, 1, ceiling);
    const hw = detectHardwareThreads();
    const target = isNode() ? hw : Math.max(1, hw - 1);
    return clampInt(target, 1, maxAutoThreads);
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
    const messageEventListeners = new Set();
    const maxLineHistory = clampInt((opts && opts.lineHistoryMax) || 2000, 10, 20000);
    const lineHistory = createLineHistory(maxLineHistory);
    const pending = [];
    let pendingHead = 0;
    let searching = false;
    let quitting = false;
    let mod;
    let onmessageHandler = null;

    function emit(line) {
      const text = String(line);
      lineHistory.push(text);
      for (const fn of listeners) fn(text);
      if (typeof onmessageHandler !== "function" && messageEventListeners.size === 0) return;
      const evt = { data: text };
      if (typeof onmessageHandler === "function") {
        try { onmessageHandler(evt); } catch (_) {}
      }
      for (const fn of messageEventListeners) {
        try { fn(evt); } catch (_) {}
      }
    }

    function maybeFlush() {
      if (searching || pendingHead >= pending.length) return;
      while (pendingHead < pending.length && !searching) {
        const cmd = pending[pendingHead++];
        rawSend(cmd);
      }
      if (pendingHead && (pendingHead === pending.length || (pendingHead >= 64 && pendingHead * 2 >= pending.length))) {
        pending.splice(0, pendingHead);
        pendingHead = 0;
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

    function waitForLine(matcher, waitOpts) {
      const pred = linePredicate(matcher);
      const timeoutMs = (waitOpts && waitOpts.timeoutMs) || 30000;
      const cached = lineHistory.find(pred);
      if (cached !== null) return Promise.resolve(cached);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Timed out waiting for engine output"));
        }, timeoutMs);

        function onLine(line) {
          let matched = false;
          try { matched = !!pred(line); } catch (e) {
            cleanup();
            reject(e);
            return;
          }
          if (!matched) return;
          cleanup();
          resolve(line);
        }

        function cleanup() {
          clearTimeout(timer);
          listeners.delete(onLine);
        }

        listeners.add(onLine);
      });
    }

    function readFile(path, fsOpts) {
      const encoding = fsOpts && fsOpts.encoding === "utf8" ? "utf8" : "binary";
      const out = mod.FS.readFile(path, { encoding: encoding === "utf8" ? "utf8" : "binary" });
      if (encoding === "utf8") return String(out);
      return out instanceof Uint8Array ? out : new Uint8Array(out);
    }

    function writeFile(path, data, fsOpts) {
      const encoding = fsOpts && fsOpts.encoding === "utf8" ? "utf8" : (typeof data === "string" ? "utf8" : "binary");
      if (encoding === "utf8") {
        mod.FS.writeFile(path, String(data));
      } else {
        mod.FS.writeFile(path, toUint8Array(data));
      }
      return path;
    }

    function unlink(path) {
      mod.FS.unlink(path);
    }

    function mkdir(path) {
      if (!path) return;
      if (typeof mod.FS.mkdirTree === "function") {
        mod.FS.mkdirTree(path);
        return;
      }
      const parts = String(path).split("/").filter(Boolean);
      let cur = "";
      for (const part of parts) {
        cur += "/" + part;
        try { mod.FS.mkdir(cur); } catch (_) {}
      }
    }

    function readdir(path) {
      return mod.FS.readdir(path);
    }

    return {
      variant,
      postMessage,
      command: postMessage,
      send: postMessage,
      loadNNUE,
      waitForLine,
      async uci(waitOpts) {
        const p = waitForLine(/^uciok$/, waitOpts);
        postMessage("uci");
        await p;
      },
      async isReady(waitOpts) {
        const p = waitForLine(/^readyok$/, waitOpts);
        postMessage("isready");
        await p;
      },
      setOption(name, value) {
        if (typeof value === "boolean") value = value ? "true" : "false";
        postMessage("setoption name " + name + (typeof value === "undefined" ? "" : " value " + value));
      },
      readFile,
      writeFile,
      unlink,
      mkdir,
      readdir,
      addMessageListener(fn) { listeners.add(fn); },
      removeMessageListener(fn) { listeners.delete(fn); },
      addEventListener(type, fn) {
        if (type === "message") messageEventListeners.add(fn);
      },
      removeEventListener(type, fn) {
        if (type === "message") messageEventListeners.delete(fn);
      },
      get onmessage() { return onmessageHandler; },
      set onmessage(fn) { onmessageHandler = typeof fn === "function" ? fn : null; },
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
    const bootstrapVariant = resolveVariant({ variant: requestedVariant, allowSIMD: opts.allowSIMD });
    const coreScript = opts.coreScript || joinPath(basePath, coreMeta(bootstrapVariant).jsFile);
    const coreScripts = opts.coreScripts || null;

    const listeners = new Set();
    const messageEventListeners = new Set();
    const errorEventListeners = new Set();
    const maxLineHistory = clampInt((opts && opts.lineHistoryMax) || 2000, 10, 20000);
    const lineHistory = createLineHistory(maxLineHistory);
    const pendingRequests = new Map();
    let worker;
    let terminated = false;
    let activeVariant = bootstrapVariant;
    let nextRequestId = 1;
    let onmessageHandler = null;
    let onerrorHandler = null;

    function emit(line) {
      const text = String(line);
      lineHistory.push(text);
      for (const fn of listeners) fn(text);
      if (typeof onmessageHandler !== "function" && messageEventListeners.size === 0) return;
      const evt = { data: text };
      if (typeof onmessageHandler === "function") {
        try { onmessageHandler(evt); } catch (_) {}
      }
      for (const fn of messageEventListeners) {
        try { fn(evt); } catch (_) {}
      }
    }

    function emitError(errorLike) {
      const err = errorLike instanceof Error ? errorLike : new Error(String(errorLike));
      if (typeof onerrorHandler === "function") {
        try { onerrorHandler(err); } catch (_) {}
      }
      for (const fn of errorEventListeners) {
        try { fn(err); } catch (_) {}
      }
    }

    function rejectPendingRequests(err) {
      const e = err instanceof Error ? err : new Error(String(err));
      for (const req of pendingRequests.values()) {
        clearTimeout(req.timer);
        req.reject(e);
      }
      pendingRequests.clear();
    }

    function callWorker(op, payload, callOpts) {
      if (terminated && !(callOpts && callOpts.allowTerminated)) {
        return Promise.reject(new Error("Worker engine already terminated"));
      }
      const requestId = nextRequestId++;
      const timeoutMs = (callOpts && callOpts.timeoutMs) || 30000;
      const transfer = (callOpts && callOpts.transfer) || [];

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error("Timed out in worker op: " + op));
        }, timeoutMs);

        pendingRequests.set(requestId, { resolve, reject, timer });

        try {
          worker.postMessage({ type: "rpc", op, requestId, ...(payload || {}) }, transfer);
        } catch (e) {
          clearTimeout(timer);
          pendingRequests.delete(requestId);
          reject(e);
        }
      });
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
          if (data.type === "rpcResult" && typeof data.requestId === "number") {
            const req = pendingRequests.get(data.requestId);
            if (req) {
              pendingRequests.delete(data.requestId);
              clearTimeout(req.timer);
              if (data.ok) req.resolve(data);
              else req.reject(new Error(data.message || ("Worker RPC failed: " + (data.op || "unknown"))));
            }
            return;
          }
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
              emitError(err);
            }
            return;
          }
          return;
        }
        emit(String(data));
      };

      worker.onerror = function(err) {
        if (err && typeof err.preventDefault === "function") {
          try { err.preventDefault(); } catch (_) {}
        }
        const e = err && err.error ? err.error : new Error(err.message || "Worker error");
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        } else {
          emit("[worker-error] " + e.message);
          emitError(e);
        }
        return true;
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
        allowSIMD: opts.allowSIMD,
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
      command(cmd) { this.postMessage(cmd); },
      send(cmd) { this.postMessage(cmd); },
      waitForLine(matcher, waitOpts) {
        const pred = linePredicate(matcher);
        const timeoutMs = (waitOpts && waitOpts.timeoutMs) || 30000;
        const cached = lineHistory.find(pred);
        if (cached !== null) return Promise.resolve(cached);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for engine output"));
          }, timeoutMs);

          function onLine(line) {
            let matched = false;
            try { matched = !!pred(line); } catch (e) {
              cleanup();
              reject(e);
              return;
            }
            if (!matched) return;
            cleanup();
            resolve(line);
          }

          function cleanup() {
            clearTimeout(timer);
            listeners.delete(onLine);
          }

          listeners.add(onLine);
        });
      },
      async uci(waitOpts) {
        const p = this.waitForLine(/^uciok$/, waitOpts);
        this.postMessage("uci");
        await p;
      },
      async isReady(waitOpts) {
        const p = this.waitForLine(/^readyok$/, waitOpts);
        this.postMessage("isready");
        await p;
      },
      setOption(name, value) {
        if (typeof value === "boolean") value = value ? "true" : "false";
        this.postMessage("setoption name " + name + (typeof value === "undefined" ? "" : " value " + value));
      },
      async loadNNUE(nnuePath) {
        await callWorker("loadNNUE", { path: nnuePath || joinPath(basePath, "pikafish.nnue") }, { timeoutMs: 120000 });
      },
      async readFile(path, fsOpts) {
        const encoding = fsOpts && fsOpts.encoding === "utf8" ? "utf8" : "binary";
        const res = await callWorker("fsRead", { path, encoding }, { timeoutMs: 120000 });
        if (encoding === "utf8") return String(res.text || "");
        if (res.buffer instanceof ArrayBuffer) return new Uint8Array(res.buffer);
        return new Uint8Array(0);
      },
      async writeFile(path, data, fsOpts) {
        const encoding = fsOpts && fsOpts.encoding === "utf8" ? "utf8" : (typeof data === "string" ? "utf8" : "binary");
        if (encoding === "utf8") {
          await callWorker("fsWrite", { path, encoding, text: String(data) }, { timeoutMs: 120000 });
          return path;
        }
        const bytes = toUint8Array(data);
        const copy = bytes.slice();
        await callWorker("fsWrite", { path, encoding, buffer: copy.buffer }, { timeoutMs: 120000, transfer: [copy.buffer] });
        return path;
      },
      async unlink(path) {
        await callWorker("fsUnlink", { path });
      },
      async mkdir(path) {
        await callWorker("fsMkdir", { path });
      },
      async readdir(path) {
        const res = await callWorker("fsReaddir", { path });
        return Array.isArray(res.entries) ? res.entries : [];
      },
      addMessageListener(fn) { listeners.add(fn); },
      removeMessageListener(fn) { listeners.delete(fn); },
      addEventListener(type, fn) {
        if (type === "message") messageEventListeners.add(fn);
        else if (type === "error") errorEventListeners.add(fn);
      },
      removeEventListener(type, fn) {
        if (type === "message") messageEventListeners.delete(fn);
        else if (type === "error") errorEventListeners.delete(fn);
      },
      get onmessage() { return onmessageHandler; },
      set onmessage(fn) { onmessageHandler = typeof fn === "function" ? fn : null; },
      get onerror() { return onerrorHandler; },
      set onerror(fn) { onerrorHandler = typeof fn === "function" ? fn : null; },
      async terminate() {
        if (terminated) return;
        terminated = true;
        try {
          await callWorker("terminate", {}, { allowTerminated: true, timeoutMs: 5000 });
        } catch (_) {}
        rejectPendingRequests(new Error("Worker engine terminated"));
        try { worker.terminate(); } catch (_) {}
      }
    };
  }

  createEngine.wasmThreadsSupported = wasmThreadsSupported;
  createEngine.wasmSIMDSupported = wasmSIMDSupported;
  createEngine.wasmSimdSupported = wasmSIMDSupported;
  createEngine.createWorkerEngine = createWorkerEngine;

  if (isNode()) {
    module.exports = createEngine;
    module.exports.createWorkerEngine = createWorkerEngine;
    module.exports.wasmThreadsSupported = wasmThreadsSupported;
    module.exports.wasmSIMDSupported = wasmSIMDSupported;
    module.exports.wasmSimdSupported = wasmSIMDSupported;
    return;
  }

    if (isWorker()) {
      let enginePromise = null;
      let basePathOverride = null;
      let nnuePathOverride = null;
      let variantOverride = "auto";
      let allowSIMDOverride = undefined;
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
            allowSIMD: allowSIMDOverride,
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

    function postRpcOk(requestId, op, payload, transfer) {
      self.postMessage({ type: "rpcResult", requestId, op, ok: true, ...(payload || {}) }, transfer || []);
    }

    function postRpcErr(requestId, op, error) {
      self.postMessage({
        type: "rpcResult",
        requestId,
        op,
        ok: false,
        message: (error && error.stack) ? error.stack : String(error)
      });
    }

    let lastWorkerErrorMessage = "";
    let lastWorkerErrorAt = 0;

    function workerErrorMessage(errorLike, fallback) {
      if (errorLike && errorLike.stack) return String(errorLike.stack);
      if (errorLike && errorLike.message) return String(errorLike.message);
      if (typeof fallback !== "undefined") return String(fallback);
      return String(errorLike);
    }

    function postWorkerError(errorLike, fallback) {
      const message = workerErrorMessage(errorLike, fallback);
      const now = Date.now();
      if (message === lastWorkerErrorMessage && now - lastWorkerErrorAt < 500) {
        return;
      }
      lastWorkerErrorMessage = message;
      lastWorkerErrorAt = now;
      try {
        self.postMessage({ type: "error", message });
      } catch (_) {}
    }

    self.onerror = function(eventOrMessage, source, lineno, colno, error) {
      postWorkerError(error || eventOrMessage, eventOrMessage && eventOrMessage.message ? eventOrMessage.message : eventOrMessage);
      if (eventOrMessage && typeof eventOrMessage.preventDefault === "function") {
        try { eventOrMessage.preventDefault(); } catch (_) {}
      }
      return true;
    };

    self.onunhandledrejection = function(event) {
      postWorkerError(event && "reason" in event ? event.reason : event);
      if (event && typeof event.preventDefault === "function") {
        try { event.preventDefault(); } catch (_) {}
      }
      return true;
    };

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
          allowSIMDOverride = data.allowSIMD;
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

        if (data && typeof data === "object" && data.type === "rpc") {
          const requestId = data.requestId;
          const op = data.op;
          try {
            if (op === "terminate") {
              await engine.terminate();
              postRpcOk(requestId, op);
              try { self.close(); } catch (_) {}
              return;
            }

            if (op === "loadNNUE") {
              const path = await engine.loadNNUE(data.path);
              postRpcOk(requestId, op, { path });
              return;
            }

            if (op === "fsRead") {
              const encoding = data.encoding === "utf8" ? "utf8" : "binary";
              const out = engine.readFile(data.path, { encoding });
              if (encoding === "utf8") {
                postRpcOk(requestId, op, { text: String(out) });
              } else {
                const bytes = (out instanceof Uint8Array) ? out : new Uint8Array(out);
                const copy = bytes.slice();
                postRpcOk(requestId, op, { buffer: copy.buffer }, [copy.buffer]);
              }
              return;
            }

            if (op === "fsWrite") {
              const encoding = data.encoding === "utf8" ? "utf8" : "binary";
              if (encoding === "utf8") {
                engine.writeFile(data.path, data.text || "", { encoding: "utf8" });
              } else {
                engine.writeFile(data.path, new Uint8Array(data.buffer || new ArrayBuffer(0)), { encoding: "binary" });
              }
              postRpcOk(requestId, op, { path: data.path });
              return;
            }

            if (op === "fsUnlink") {
              engine.unlink(data.path);
              postRpcOk(requestId, op);
              return;
            }

            if (op === "fsMkdir") {
              engine.mkdir(data.path);
              postRpcOk(requestId, op);
              return;
            }

            if (op === "fsReaddir") {
              postRpcOk(requestId, op, { entries: engine.readdir(data.path) });
              return;
            }

            throw new Error("Unknown RPC op: " + op);
          } catch (e) {
            postRpcErr(requestId, op, e);
            return;
          }
        }

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
        postWorkerError(e);
      }
    };
    self.Pikafish = createEngine;
    return;
  }

  self.Pikafish = createEngine;
})();
