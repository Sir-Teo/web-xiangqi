"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const distDir = path.resolve(__dirname, "..", "dist");
  await Promise.all([
    fs.rm(path.join(distDir, "assets"), { recursive: true, force: true }),
    fs.rm(path.join(distDir, "index.html"), { force: true }),
    fs.rm(path.join(distDir, "sw.js"), { force: true }),
    fs.rm(path.join(distDir, "vite.svg"), { force: true }),
  ]);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
