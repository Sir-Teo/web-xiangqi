const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-xiangqi-library-"));

function compileTsModule(relativePath) {
  const sourcePath = path.join(root, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourcePath,
  });
  const targetPath = path.join(tempDir, path.basename(relativePath).replace(/\.ts$/, ".js"));
  fs.writeFileSync(targetPath, output.outputText);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  compileTsModule("src/utils/moveNotation.ts");
  compileTsModule("src/utils/review.ts");
  compileTsModule("src/utils/gameLibrary.ts");

  const library = require(path.join(tempDir, "gameLibrary.js"));
  const customFen = "9/9/9/9/9/9/9/9/4K4/4k4 w - - 0 1";

  const fenOnlySave = library.normalizeSavedGame({
    id: "fen-only",
    savedAt: 1710000000000,
    gameMode: "PvP",
    moves: [],
    startFen: customFen,
    result: "ongoing",
  });
  assert(fenOnlySave, "FEN-only saves with a startFen should be preserved.");
  assert(fenOnlySave.moves.length === 0, "FEN-only save should keep an empty move list.");
  assert(fenOnlySave.startFen === customFen, "FEN-only save should keep its root FEN.");

  const emptyLegacySave = library.normalizeSavedGame({
    id: "empty-legacy",
    savedAt: 1710000000001,
    gameMode: "PvP",
    moves: [],
  });
  assert(emptyLegacySave === null, "Empty saves without a startFen should still be rejected.");

  console.log("Library normalization checks passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
