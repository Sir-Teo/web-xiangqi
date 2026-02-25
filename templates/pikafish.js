"use strict";

(function() {
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

  function getCoreFactory(opts) {
    if (opts && opts.coreFactory) return opts.coreFactory;
    if (isNode()) {
      const path = require("path");
      const corePath = (opts && opts.coreJsPath) || path.join(opts.basePath || __dirname, "pikafish-core.js");
      return require(corePath);
    }
    if (typeof PikafishCore !== "undefined") return PikafishCore;
    throw new Error("PikafishCore not found. Load pikafish-core.js first.");
  }

  async function createEngine(opts) {
    opts = opts || {};
    const basePath = opts.basePath || defaultBasePath();
    const coreFactory = getCoreFactory({ ...opts, basePath });
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

    mod = await coreFactory({
      listener: onLine,
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

    if (opts.autoLoadNNUE !== false) {
      await loadNNUE(opts.nnuePath);
    }

    return {
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

  if (isNode()) {
    module.exports = createEngine;
    return;
  }

  if (isWorker()) {
    let enginePromise = null;
    let basePathOverride = null;
    let nnuePathOverride = null;

    function ensureEngine() {
      if (!enginePromise) {
        enginePromise = createEngine({
          basePath: basePathOverride || defaultBasePath(),
          nnuePath: nnuePathOverride || null
        });
      }
      return enginePromise;
    }

    self.onmessage = async function(event) {
      const data = event.data;
      if (data && typeof data === "object" && data.type === "init") {
        if (data.coreScript) importScripts(data.coreScript);
        basePathOverride = data.basePath || basePathOverride;
        nnuePathOverride = data.nnuePath || nnuePathOverride;
        await ensureEngine();
        return;
      }
      const engine = await ensureEngine();
      engine.addMessageListener(function forward(line) {
        self.postMessage(line);
        if (/^bestmove\b/.test(line) || line === "uciok" || line === "readyok") {
          engine.removeMessageListener(forward);
        }
      });
      engine.postMessage(String(data));
    };
    self.Pikafish = createEngine;
    return;
  }

  self.Pikafish = createEngine;
})();

