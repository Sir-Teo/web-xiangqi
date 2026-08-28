const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-xiangqi-openings-"));

const compiled = new Set();

/**
 * Relative imports that survive transpiling, so the ones this file will actually
 * require at runtime. Type-only imports are erased, and are skipped here so a
 * `import type { GameMode } from "../App"` does not drag a component tree in.
 */
function runtimeRelativeImports(source) {
  const found = new Set();
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[^;]*?from\s*["'](\.[^"']+)["']/g;
  for (const match of source.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

/**
 * Compiles a module and everything it imports, rather than a list kept by hand.
 * The hand-kept list went stale the moment a new import was added — the failure
 * was a bare MODULE_NOT_FOUND from the temp directory, and it only showed up in
 * CI. Everything lands flat in tempDir under its basename, which is how the
 * emitted relative requires resolve.
 */
function compileTsModule(relativePath) {
  if (compiled.has(relativePath)) return;
  compiled.add(relativePath);

  const sourcePath = path.join(root, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");

  for (const specifier of runtimeRelativeImports(source)) {
    const resolved = path.resolve(path.dirname(sourcePath), specifier);
    for (const candidate of [`${resolved}.ts`, path.join(resolved, "index.ts")]) {
      if (fs.existsSync(candidate)) {
        compileTsModule(path.relative(root, candidate));
        break;
      }
    }
  }

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

function isPlayableOpening(entry, xiangqi) {
  let board = xiangqi.parseFenBoard(xiangqi.START_FEN);
  let side = "w";

  for (const uci of entry.moves) {
    const from = xiangqi.uciToSquare(uci.substring(0, 2));
    const to = xiangqi.uciToSquare(uci.substring(2, 4));
    if (!from || !to) return false;

    const result = xiangqi.validatePieceMove(board, {
      fromFile: from.file,
      fromRank: from.rank,
      toFile: to.file,
      toRank: to.rank,
      raw: uci,
    }, side);
    if (!result.ok) return false;

    const nextBoard = board.map((row) => row.slice());
    nextBoard[to.rank][to.file] = result.piece || "";
    nextBoard[from.rank][from.file] = "";
    board = nextBoard;
    side = side === "w" ? "b" : "w";
  }

  return true;
}

try {
  compileTsModule("src/utils/xiangqi.ts");
  compileTsModule("src/utils/openings.ts");

  const xiangqi = require(path.join(tempDir, "xiangqi.js"));
  const openings = require(path.join(tempDir, "openings.js"));

  const illegalEntries = openings.OPENINGS.filter((entry) => !isPlayableOpening(entry, xiangqi));
  assert(
    illegalEntries.length === 0,
    `Opening book contains unplayable entries: ${illegalEntries.map((entry) => entry.name).join(", ")}`
  );

  const pawnOpening = openings.matchOpening(["c3c4"]);
  assert(pawnOpening?.name === "Pawn Opening", "c3c4 should identify the pawn opening.");

  const startingCandidates = openings.getOpeningCandidates([]);
  assert(startingCandidates.length > 0, "Starting position should expose book candidates.");
  assert(
    startingCandidates.some((candidate) => candidate.move === "h2e2"),
    "Starting candidates should include Central Cannon h2e2."
  );

  const centralCannonCandidates = openings.getOpeningCandidates(["h2e2"]);
  assert(
    centralCannonCandidates.some((candidate) => candidate.move === "h9g7"),
    "Central Cannon candidates should include Screen Horse h9g7."
  );
  assert(
    centralCannonCandidates.every((candidate) => candidate.names.length > 0 && candidate.count > 0),
    "Opening candidates should carry display names and line counts."
  );

  const pawnCannonReply = openings.matchOpening(["c3c4", "h7e7"]);
  assert(
    pawnCannonReply?.name === "Pawn Opening — Cannon Reply",
    "c3c4 h7e7 should identify the pawn opening cannon reply."
  );

  const centralCannonPawnCounter = openings.matchOpening(["h2e2", "c6c5"]);
  assert(
    centralCannonPawnCounter?.name === "Central Cannon — Pawn Counter",
    "h2e2 c6c5 should identify the central cannon pawn counter."
  );

  const chariotMove = openings.matchOpening(["a0a1"]);
  assert(chariotMove === null, "a0a1 is a chariot move and must not be labeled as a pawn opening.");

  console.log(`Opening regression checks passed (${openings.OPENINGS.length} playable entries, 0 filtered).`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
