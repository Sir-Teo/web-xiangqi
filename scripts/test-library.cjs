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
  compileTsModule("src/utils/xiangqi.ts");
  compileTsModule("src/utils/review.ts");
  compileTsModule("src/utils/gameLibrary.ts");
  compileTsModule("src/utils/gameExport.ts");
  compileTsModule("src/utils/moveImport.ts");

  const library = require(path.join(tempDir, "gameLibrary.js"));
  const gameExport = require(path.join(tempDir, "gameExport.js"));
  const moveImport = require(path.join(tempDir, "moveImport.js"));
  const xiangqi = require(path.join(tempDir, "xiangqi.js"));
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

  const uppercaseMoveSave = library.normalizeSavedGame({
    id: "uppercase-move",
    savedAt: 1710000000002,
    gameMode: "PvP",
    moves: ["B2E2", "H9G7"],
  });
  assert(uppercaseMoveSave, "Uppercase coordinate saves should be accepted for legacy compatibility.");
  assert(
    uppercaseMoveSave.moves.join(" ") === "b2e2 h9g7",
    `Saved moves should normalize to lowercase UCI, got: ${uppercaseMoveSave.moves.join(" ")}`
  );

  const malformedMoveSave = library.normalizeSavedGame({
    id: "malformed-move",
    savedAt: 1710000000003,
    gameMode: "PvP",
    moves: ["b2e2", "h9-g7"],
  });
  assert(malformedMoveSave === null, "Saved games with malformed coordinate moves should be rejected.");

  const invalidFenSave = library.normalizeSavedGame({
    id: "invalid-fen-root",
    savedAt: 1710000000004,
    gameMode: "PvP",
    moves: ["b2e2"],
    startFen: "9/9/9 w - - 0 1",
  });
  assert(invalidFenSave === null, "Saved games with invalid root FEN should be rejected.");

  const missingKingFenSave = library.normalizeSavedGame({
    id: "missing-king-root",
    savedAt: 1710000000005,
    gameMode: "PvP",
    moves: ["b2e2"],
    startFen: "9/9/9/9/9/9/9/9/9/4k4 w - - 0 1",
  });
  assert(missingKingFenSave === null, "Saved games with root FENs missing either king should be rejected.");

  const defaultPgn = gameExport.exportPgnFromUci(["b2e2", "h9g7"], {
    gameMode: "PvP",
    date: "2026.05.31",
  });
  assert(!defaultPgn.includes('[SetUp "1"]'), "Default-start PGN should not include SetUp.");
  assert(!defaultPgn.includes("[FEN "), "Default-start PGN should not include a FEN tag.");
  assert(defaultPgn.includes("1. b2e2 h9g7 *"), "Default-start PGN should keep ordinary move numbering.");

  const blackToMoveFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17";
  const customPgn = gameExport.exportPgnFromUci(["a6a5", "a3a4"], {
    gameMode: "PvAI-Black",
    date: "2026.05.31",
    startFen: blackToMoveFen,
    label: 'Custom "study"',
  });
  assert(customPgn.includes('[SetUp "1"]'), "Custom-FEN PGN should include SetUp.");
  assert(customPgn.includes(`[FEN "${blackToMoveFen}"]`), "Custom-FEN PGN should include the exact root FEN.");
  assert(customPgn.includes('[White "Custom \\"study\\""]'), "PGN tag values should escape quotes.");
  assert(customPgn.includes("17... a6a5 18. a3a4 *"), "Black-to-move PGN should start with black move numbering.");

  const studyTreePgn = gameExport.exportPgnTree({
    root: { id: "root", parentId: null, childrenIds: ["n1", "n3"] },
    n1: { id: "n1", parentId: "root", childrenIds: ["n2"], record: { uci: "b2e2" } },
    n2: { id: "n2", parentId: "n1", childrenIds: [], record: { uci: "h9g7" } },
    n3: { id: "n3", parentId: "root", childrenIds: [], record: { uci: "b0c2" } },
  }, "root", {
    gameMode: "PvP",
    date: "2026.05.31",
    mainLineNodeIds: ["n3"],
  });
  assert(studyTreePgn.includes("1. b0c2 (1. b2e2 h9g7) *"), `Tree PGN should preserve root variations:\n${studyTreePgn}`);

  const blackRootTreePgn = gameExport.exportPgnTree({
    root: { id: "root", parentId: null, childrenIds: ["n1", "n2"] },
    n1: { id: "n1", parentId: "root", childrenIds: [], record: { uci: "a6a5" } },
    n2: { id: "n2", parentId: "root", childrenIds: [], record: { uci: "h9g7" } },
  }, "root", {
    date: "2026.05.31",
    startFen: blackToMoveFen,
    mainLineNodeIds: ["n1"],
  });
  assert(blackRootTreePgn.includes("17... a6a5 (17... h9g7) *"), `Tree PGN should number black-to-move root variations:\n${blackRootTreePgn}`);

  const nestedVariationPgn = gameExport.exportPgnTree({
    root: { id: "root", parentId: null, childrenIds: ["n1"] },
    n1: { id: "n1", parentId: "root", childrenIds: ["n2", "n3"], record: { uci: "b2e2" } },
    n2: { id: "n2", parentId: "n1", childrenIds: [], record: { uci: "h9g7" } },
    n3: { id: "n3", parentId: "n1", childrenIds: [], record: { uci: "b9c7" } },
  }, "root", {
    date: "2026.05.31",
    mainLineNodeIds: ["n1", "n2"],
  });
  assert(nestedVariationPgn.includes("1. b2e2 h9g7 (1... b9c7) *"), `Tree PGN should preserve black reply variations:\n${nestedVariationPgn}`);

  const importedLine = moveImport.extractUciMoveLine(`
    [Variant "Xiangqi"]
    1. B2E2 h9g7 {book} 2. b0c2 ; trailing comment
    *
  `);
  assert(
    importedLine.join(" ") === "b2e2 h9g7 b0c2",
    `UCI move import should extract and normalize moves, got: ${importedLine.join(" ")}`
  );

  const importedSeparatedLine = moveImport.extractUciMoveLine(`
    [Variant "Chinese Chess"]
    1. B2-E2 h9→g7 2. b0->c2
  `);
  assert(
    importedSeparatedLine.join(" ") === "b2e2 h9g7 b0c2",
    `Coordinate-separated move import should normalize moves, got: ${importedSeparatedLine.join(" ")}`
  );

  const importedVariationMainline = moveImport.extractUciMoveLine(`
    [Variant "Xiangqi"]
    1. b2e2 (1. b0c2 {side line}) h9g7
  `);
  assert(
    importedVariationMainline.join(" ") === "b2e2 h9g7",
    `PGN variation import should keep the mainline only, got: ${importedVariationMainline.join(" ")}`
  );

  const promotedChessMove = moveImport.extractUciMoveLine(`
    [Variant "Xiangqi"]
    1. b2e2q
  `);
  assert(
    promotedChessMove.length === 0,
    `Xiangqi import should reject chess-style promotion suffixes, got: ${promotedChessMove.join(" ")}`
  );

  const startBoard = xiangqi.parseFenBoard(xiangqi.START_FEN);
  const strictMove = xiangqi.validateMoveStr("b2e2junk", startBoard, "w");
  assert(!strictMove.ok && strictMove.reason === "invalid move format", "validateMoveStr should reject suffixed UCI moves.");
  const uppercaseStrictMove = xiangqi.validateMoveStr("B2E2", startBoard, "w");
  assert(uppercaseStrictMove.ok && uppercaseStrictMove.mv.raw === "b2e2", "validateMoveStr should normalize uppercase UCI moves.");

  const importedFen = moveImport.extractFenTag(`
    [Variant "Xiangqi"]
    [FEN "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17"]

    17... h9g7 *
  `);
  assert(importedFen === "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 17", "Move import should extract a FEN tag.");

  console.log("Library normalization, PGN export, and move import checks passed.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
