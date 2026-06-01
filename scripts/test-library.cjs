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
  compileTsModule("src/utils/shareTree.ts");
  compileTsModule("src/utils/gameExport.ts");
  compileTsModule("src/utils/moveImport.ts");
  compileTsModule("src/utils/aiOpponent.ts");

  const library = require(path.join(tempDir, "gameLibrary.js"));
  const shareTree = require(path.join(tempDir, "shareTree.js"));
  const gameExport = require(path.join(tempDir, "gameExport.js"));
  const moveImport = require(path.join(tempDir, "moveImport.js"));
  const moveNotation = require(path.join(tempDir, "moveNotation.js"));
  const xiangqi = require(path.join(tempDir, "xiangqi.js"));
  const aiOpponent = require(path.join(tempDir, "aiOpponent.js"));
  const customFen = "4k4/9/9/9/4p4/9/9/9/9/4K4 w - - 0 1";

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

  const rootStudySave = library.normalizeSavedGame({
    id: "root-study",
    savedAt: 1710000000001,
    gameMode: "PvP",
    moves: [],
    moveTree: [
      { uci: "B2E2", children: [{ uci: "H9G7" }] },
      { uci: "B0C2" },
    ],
    result: "ongoing",
  });
  assert(rootStudySave, "Root-position study trees should be accepted without forcing a mainline move.");
  assert(rootStudySave.moves.length === 0, "Root-position study saves should keep an empty current line.");
  assert(rootStudySave.moveTree?.[0]?.uci === "b2e2", "Root-position study tree moves should normalize.");

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

  const flyingKingsFenSave = library.normalizeSavedGame({
    id: "flying-kings-root",
    savedAt: 1710000000005,
    gameMode: "PvP",
    moves: ["b2e2"],
    startFen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",
  });
  assert(flyingKingsFenSave === null, "Saved games with flying kings in the root FEN should be rejected.");

  const nonMovingSideInCheckFenSave = library.normalizeSavedGame({
    id: "non-moving-side-check-root",
    savedAt: 1710000000005,
    gameMode: "PvP",
    moves: ["b2e2"],
    startFen: "4k4/4R4/9/9/9/9/9/9/9/4K4 w - - 0 1",
  });
  assert(nonMovingSideInCheckFenSave === null, "Saved games with the non-moving side in check should be rejected.");

  const palaceViolationFenSave = library.normalizeSavedGame({
    id: "palace-violation-root",
    savedAt: 1710000000005,
    gameMode: "PvP",
    moves: ["b2e2"],
    startFen: "4k4/9/9/9/4p4/9/9/9/9/K8 w - - 0 1",
  });
  assert(palaceViolationFenSave === null, "Saved games with kings outside their palaces should be rejected.");

  const invalidTimestampSave = library.normalizeSavedGame({
    id: "invalid-timestamp",
    savedAt: 1e100,
    gameMode: "PvP",
    moves: ["b2e2"],
  });
  assert(invalidTimestampSave === null, "Saved games with out-of-range timestamps should be rejected.");

  const oversizedMoveSave = library.normalizeSavedGame({
    id: "oversized-move-list",
    savedAt: 1710000000006,
    gameMode: "PvP",
    moves: Array.from({ length: 1025 }, () => "b2e2"),
  });
  assert(oversizedMoveSave === null, "Saved games with oversized move lists should be rejected.");

  const boundedTextSave = library.normalizeSavedGame({
    id: "bounded-text",
    savedAt: 1710000000007,
    gameMode: "PvP",
    moves: ["b2e2"],
    label: ` ${"Label".repeat(40)} `,
    opening: ` ${"Opening".repeat(40)} `,
    review: {
      summary: {
        totalMoves: 999,
        accuracy: 72,
        averageCentipawnLoss: 9999999,
        redAccuracy: 105,
        blackAccuracy: -4,
        redAverageCentipawnLoss: 120.6,
        blackAverageCentipawnLoss: -4,
        lineSignature: "s".repeat(9000),
        engine: {
          tier: "mid",
          baseDepth: 99.8,
          baseMoveTimeMs: 9999999,
          revisitDepth: 11.9,
          revisitMoveTimeMs: 2400.5,
        },
        keyMoments: [{
          nodeId: "node".repeat(60),
          moveIndex: 0,
          jumpTarget: 0,
          ply: 1,
          side: "red",
          quality: "mistake",
          swing: 220,
          evalBefore: 0,
          evalAfter: -220,
          playedMove: "b2e2",
          note: "note".repeat(200),
        }],
      },
      annotations: [
        { moveIndex: 0, reviewNote: "review".repeat(200) },
        { moveIndex: 8, reviewNote: "off-line" },
      ],
    },
  });
  assert(boundedTextSave, "Shape-valid saved game text should normalize.");
  assert(boundedTextSave.label.length === 120, "Saved labels should be trimmed and capped.");
  assert(boundedTextSave.opening.length === 160, "Saved openings should be trimmed and capped.");
  assert(boundedTextSave.review.summary.totalMoves === 1, "Review totalMoves should not exceed the saved line length.");
  assert(boundedTextSave.review.summary.averageCentipawnLoss === 100000, "Review average centipawn loss should be capped.");
  assert(boundedTextSave.review.summary.redAccuracy === 100, "Review red accuracy should be clamped.");
  assert(boundedTextSave.review.summary.blackAccuracy === 0, "Review black accuracy should be clamped.");
  assert(boundedTextSave.review.summary.redAverageCentipawnLoss === 120, "Review red average centipawn loss should be integer-normalized.");
  assert(boundedTextSave.review.summary.blackAverageCentipawnLoss === 0, "Review black average centipawn loss should be clamped.");
  assert(boundedTextSave.review.summary.lineSignature.length === 8192, "Review line signatures should be capped.");
  assert(boundedTextSave.review.summary.engine.tier === "mid", "Review engine tiers should be preserved.");
  assert(boundedTextSave.review.summary.engine.baseDepth === 99, "Review engine depths should be integer-normalized.");
  assert(boundedTextSave.review.summary.engine.baseMoveTimeMs === 600000, "Review engine move times should be capped.");
  assert(boundedTextSave.review.summary.engine.revisitDepth === 11, "Review revisit depths should be integer-normalized.");
  assert(boundedTextSave.review.summary.engine.revisitMoveTimeMs === 2400, "Review revisit move times should be integer-normalized.");
  assert(boundedTextSave.review.summary.keyMoments[0].nodeId.length === 96, "Review node ids should be capped.");
  assert(boundedTextSave.review.summary.keyMoments[0].note.length === 500, "Review key-moment notes should be capped.");
  assert(
    boundedTextSave.review.summary.keyMoments[0].winPercentLoss > 18 &&
      boundedTextSave.review.summary.keyMoments[0].winPercentLoss < 20,
    "Review key-moment chance loss should be derived when older saves do not provide it."
  );
  assert(boundedTextSave.review.annotations.length === 1, "Off-line review annotations should be dropped.");
  assert(boundedTextSave.review.annotations[0].reviewNote.length === 500, "Review annotation notes should be capped.");

  const manySavedGames = Array.from({ length: 505 }, (_, index) => ({
    id: `saved-${index}`,
    savedAt: 1710000010000 + index,
    gameMode: "PvP",
    moves: ["b2e2"],
  }));
  const normalizedManySavedGames = library.normalizeSavedGames(manySavedGames);
  assert(normalizedManySavedGames.length === 500, "Saved game lists should be capped for storage/rendering safety.");
  assert(normalizedManySavedGames[0].id === "saved-5", "Saved game list capping should keep the newest entries.");
  assert(normalizedManySavedGames.at(-1).id === "saved-504", "Saved game list capping should preserve newest saved entries.");
  const normalizedReversedSavedGames = library.normalizeSavedGames(manySavedGames.slice().reverse());
  assert(normalizedReversedSavedGames.length === 500, "Reversed saved game lists should still be capped.");
  assert(normalizedReversedSavedGames[0].id === "saved-5", "Saved game capping should use savedAt rather than storage order.");
  assert(normalizedReversedSavedGames.at(-1).id === "saved-504", "Saved game capping should keep the newest timestamp in reversed storage.");

  const corruptReviewedSave = library.normalizeSavedGame({
    id: "corrupt-reviewed",
    savedAt: 1710000000008,
    gameMode: "PvP",
    moves: ["b2e2", "h9g7"],
    review: {
      summary: {
        totalMoves: -3,
        accuracy: 999.8,
        bestCount: 1.9,
        goodCount: 2.7,
        inaccuracyCount: -4,
        mistakeCount: 1.2,
        blunderCount: 3.4,
        reviewedAt: 1e100,
        engine: {
          tier: "high",
          baseDepth: 10.9,
          baseMoveTimeMs: 1500.8,
          revisitDepth: 12,
          revisitMoveTimeMs: "slow",
        },
        keyMoments: [{
          moveIndex: 1.8,
          jumpTarget: 1.1,
          ply: 2.9,
          side: "black",
          quality: "blunder",
          swing: 420.6,
          winPercentLoss: 101.5,
          evalBefore: 20,
          evalAfter: -401,
          bestMove: "B9C7",
          playedMove: "H9G7",
          note: "Large swing.",
        }],
      },
      annotations: [
        { moveIndex: 0.8, evalScore: 20, bestMove: "B9C7", quality: "best", winPercentLoss: 101.5, reviewNote: "ok" },
      ],
    },
  });
  assert(corruptReviewedSave?.review, "Corrupt but shape-valid review snapshots should normalize.");
  assert(corruptReviewedSave.review.summary.totalMoves === 2, "Negative reviewed move counts should fall back to the saved line length.");
  assert(corruptReviewedSave.review.summary.accuracy === 100, "Review accuracy should be clamped to 0-100.");
  assert(corruptReviewedSave.review.summary.bestCount === 1, "Review counts should be truncated to nonnegative integers.");
  assert(corruptReviewedSave.review.summary.goodCount === 2, "Review counts should preserve valid integer portions.");
  assert(corruptReviewedSave.review.summary.inaccuracyCount === 0, "Negative review counts should normalize to zero.");
  assert(corruptReviewedSave.review.summary.mistakeCount === 1, "Review mistake counts should normalize.");
  assert(corruptReviewedSave.review.summary.blunderCount === 2, "Review blunder counts should clamp to the saved line length.");
  assert(corruptReviewedSave.review.summary.engine.tier === "high", "Shape-valid review engine metadata should normalize.");
  assert(corruptReviewedSave.review.summary.engine.baseDepth === 10, "Review engine base depth should truncate to an integer.");
  assert(corruptReviewedSave.review.summary.engine.baseMoveTimeMs === 1500, "Review engine base move time should truncate to an integer.");
  assert(corruptReviewedSave.review.summary.engine.revisitDepth === undefined, "Partial revisit metadata should be dropped.");
  assert(
    Number.isFinite(new Date(corruptReviewedSave.review.summary.reviewedAt).getTime()) &&
      corruptReviewedSave.review.summary.reviewedAt !== 1e100,
    "Invalid review timestamps should be replaced with a valid timestamp."
  );
  assert(corruptReviewedSave.review.summary.keyMoments[0]?.moveIndex === 1, "Review key moments should use integer move indexes.");
  assert(corruptReviewedSave.review.summary.keyMoments[0]?.winPercentLoss === 100, "Review key-moment chance loss should be clamped.");
  assert(corruptReviewedSave.review.summary.keyMoments[0]?.bestMove === "b9c7", "Review key-moment best moves should normalize.");
  assert(corruptReviewedSave.review.summary.keyMoments[0]?.playedMove === "h9g7", "Review key-moment played moves should normalize.");
  assert(corruptReviewedSave.review.annotations[0]?.moveIndex === 0, "Review annotation move indexes should normalize.");
  assert(corruptReviewedSave.review.annotations[0]?.bestMove === "b9c7", "Review annotation best moves should normalize.");
  assert(corruptReviewedSave.review.annotations[0]?.winPercentLoss === 100, "Review annotation chance loss should be clamped.");

  const savedStudyTree = library.normalizeSavedGame({
    id: "saved-study-tree",
    savedAt: 1710000000009,
    gameMode: "PvP",
    moves: ["B0C2"],
    moveTree: [
      { uci: "B2E2", children: [{ uci: "H9G7" }] },
      { uci: "B0C2" },
    ],
  });
  assert(savedStudyTree, "Saved study trees should be accepted.");
  assert(savedStudyTree.moves.join(" ") === "b0c2", "Saved study mainline should normalize uppercase moves.");
  assert(savedStudyTree.moveTree?.[0]?.uci === "b2e2", "Saved study tree root move should normalize uppercase moves.");
  assert(savedStudyTree.moveTree?.[0]?.children?.[0]?.uci === "h9g7", "Saved study tree child move should normalize uppercase moves.");

  const maxSizedStudyTree = library.normalizeSavedGame({
    id: "max-sized-study-tree",
    savedAt: 1710000000010,
    gameMode: "PvP",
    moves: ["b2e2"],
    moveTree: Array.from({ length: 1024 }, () => ({ uci: "b2e2" })),
  });
  assert(maxSizedStudyTree?.moveTree?.length === 1024, "Saved study trees should preserve the full 1024-node import cap.");

  const oversizedSavedStudyTree = library.normalizeSavedGame({
    id: "oversized-study-tree",
    savedAt: 1710000000011,
    gameMode: "PvP",
    moves: ["b2e2"],
    moveTree: Array.from({ length: 1025 }, () => ({ uci: "b2e2" })),
  });
  assert(oversizedSavedStudyTree === null, "Saved study trees beyond the 1024-node cap should still be rejected.");

  const malformedSavedStudyTree = library.normalizeSavedGame({
    id: "bad-study-tree",
    savedAt: 1710000000007,
    gameMode: "PvP",
    moves: ["b0c2"],
    moveTree: [{ uci: "b2e2q" }],
  });
  assert(malformedSavedStudyTree === null, "Saved study trees with malformed moves should be rejected.");

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

  const savedStudyTreePgn = gameExport.exportPgnFromMoveTree(savedStudyTree.moveTree, {
    gameMode: savedStudyTree.gameMode,
    mainLineMoves: savedStudyTree.moves,
    date: "2026.05.31",
    label: "Saved Study",
  });
  assert(savedStudyTreePgn.includes('[White "Saved Study"]'), `Saved study tree PGN should include the saved label:\n${savedStudyTreePgn}`);
  assert(savedStudyTreePgn.includes("1. b0c2 (1. b2e2 h9g7) *"), `Saved study tree PGN should preserve variations:\n${savedStudyTreePgn}`);

  const mismatchedSavedTreePgn = gameExport.exportPgnFromMoveTree(savedStudyTree.moveTree, {
    mainLineMoves: ["a0a1"],
    date: "2026.05.31",
  });
  assert(mismatchedSavedTreePgn === null, "Saved study tree PGN should fail when the saved mainline is not in the tree.");
  const mismatchedSavedTreeFallbackPgn = mismatchedSavedTreePgn ?? gameExport.exportPgnFromUci(["a0a1"], {
    date: "2026.05.31",
  });
  assert(
    mismatchedSavedTreeFallbackPgn.includes("1. a0a1 *"),
    `Library export fallback should preserve the saved mainline instead of exporting a wrong tree branch:\n${mismatchedSavedTreeFallbackPgn}`
  );

  const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const originalConsoleWarn = console.warn;
  const storageWarnings = [];
  try {
    console.warn = (...args) => storageWarnings.push(args.map(String).join(" "));
    const storedValues = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => storedValues.get(key) ?? null,
        setItem: (key, value) => storedValues.set(key, String(value)),
      },
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });
    const fallbackIdSave = library.saveGame({
      gameMode: "PvP",
      moves: ["b2e2"],
      result: "ongoing",
    });
    assert(fallbackIdSave, "Saving should work when crypto.randomUUID is unavailable.");
    assert(
      /^game-[a-z0-9]+-[a-z0-9]+$/.test(fallbackIdSave.id),
      `Fallback saved-game id should be stable and nonempty, got: ${fallbackIdSave.id}`
    );
    const storedGames = JSON.parse(storedValues.get("xiangqi-game-library") || "[]");
    assert(storedGames[0]?.id === fallbackIdSave.id, "Fallback id save should be persisted.");
    assert(library.renameGame(fallbackIdSave.id, ` ${"Renamed".repeat(30)} `), "Renaming should work with long labels.");
    const renamedGames = JSON.parse(storedValues.get("xiangqi-game-library") || "[]");
    assert(renamedGames[0]?.label.length === 120, "Saved game rename labels should be capped before persistence.");
    assert(!renamedGames[0]?.label.startsWith(" "), "Saved game rename labels should be trimmed before persistence.");
    storedValues.set("xiangqi-game-library", JSON.stringify(
      Array.from({ length: 500 }, (_, index) => ({
        id: `stored-${index}`,
        savedAt: 1710001000000 + index,
        gameMode: "PvP",
        moves: ["b2e2"],
        result: "ongoing",
      }))
    ));
    const cappedSave = library.saveGame({
      gameMode: "PvP",
      moves: ["b0c2"],
      result: "ongoing",
    });
    assert(cappedSave, "Saving should work when the library is at the saved-game cap.");
    const cappedStoredGames = JSON.parse(storedValues.get("xiangqi-game-library") || "[]");
    assert(cappedStoredGames.length === 500, "Saving past the game cap should not grow persisted storage.");
    assert(cappedStoredGames[0]?.id === "stored-1", "Saving past the cap should drop the oldest game.");
    assert(cappedStoredGames.at(-1)?.id === cappedSave.id, "The newest saved game should remain after capping.");
    const oversizedRawLibrary = "x".repeat(3_000_001);
    storedValues.set("xiangqi-game-library", oversizedRawLibrary);
    assert(library.loadAllGames().length === 0, "Oversized raw saved-game storage should be ignored before JSON parsing.");
    assert(
      library.saveGame({ gameMode: "PvP", moves: ["b2e2"], result: "ongoing" }) === null,
      "Saving should fail instead of overwriting oversized raw saved-game storage."
    );
    assert(
      storedValues.get("xiangqi-game-library") === oversizedRawLibrary,
      "Oversized raw saved-game storage should remain untouched after a failed save."
    );
    assert(!library.renameGame("stored-1", "Keep me"), "Renaming should fail while raw storage is oversized.");
    assert(!library.deleteGame("stored-1"), "Deleting should fail while raw storage is oversized.");
    assert(
      storedValues.get("xiangqi-game-library") === oversizedRawLibrary,
      "Oversized raw saved-game storage should remain untouched after failed mutations."
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => "[]",
        setItem: () => {
          throw new Error("storage blocked");
        },
      },
    });
    assert(
      library.saveGame({ gameMode: "PvP", moves: ["b2e2"], result: "ongoing" }) === null,
      "Saving should fail cleanly when browser storage writes are blocked."
    );
    assert(
      storageWarnings.length === 0,
      `Storage mutation failures should not write production console warnings: ${storageWarnings.join("; ")}`
    );
  } finally {
    console.warn = originalConsoleWarn;
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
  }

  const encodedStudyTree = shareTree.encodeSavedMoveTreeParam(savedStudyTree.moveTree);
  assert(encodedStudyTree, "Saved study trees should encode into share-link params.");
  const decodedStudyTree = shareTree.decodeSavedMoveTreeParam(encodedStudyTree);
  assert(decodedStudyTree?.[0]?.uci === "b2e2", "Share-link study tree root move should decode.");
  assert(decodedStudyTree?.[0]?.children?.[0]?.uci === "h9g7", "Share-link study tree child move should decode.");
  assert(shareTree.decodeSavedMoveTreeParam("not-valid-base64") === null, "Malformed share-link study trees should be rejected.");
  assert(
    shareTree.decodeSavedMoveTreeParam("A".repeat(12000)) === null,
    "Oversized share-link study tree params should be rejected before parsing."
  );

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
  assert(
    moveImport.isMoveImportTextTooLarge("x".repeat(moveImport.MAX_MOVE_IMPORT_TEXT_LENGTH + 1)),
    "Move import should identify oversized pasted/file text before parsing."
  );
  const oversizedImportedLine = moveImport.extractUciMoveLine(
    Array.from({ length: moveImport.MAX_MOVE_IMPORT_UCI_MOVES + 2 }, () => "b2e2").join(" ")
  );
  assert(
    oversizedImportedLine.length === moveImport.MAX_MOVE_IMPORT_UCI_MOVES + 1,
    "UCI line extraction should stop once it has enough moves to report an oversized import."
  );
  const oversizedImportedTree = moveImport.extractUciMoveTree(
    Array.from({ length: moveImport.MAX_MOVE_IMPORT_TREE_NODES + 2 }, () => "b2e2").join(" ")
  );
  assert(oversizedImportedTree.tooLarge, "Move tree extraction should report oversized trees.");

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
  const importedVariationTree = moveImport.extractUciMoveTree(`
    [Variant "Xiangqi"]
    1. b2e2 (1. b0c2 {side line}) h9g7
  `);
  assert(
    importedVariationTree.moves.join(" ") === "b2e2 h9g7",
    `PGN variation tree import should keep the active mainline, got: ${importedVariationTree.moves.join(" ")}`
  );
  assert(
    importedVariationTree.hasVariations &&
      importedVariationTree.moveTree[0]?.uci === "b2e2" &&
      importedVariationTree.moveTree[1]?.uci === "b0c2",
    `PGN variation tree import should preserve the root branch, got: ${JSON.stringify(importedVariationTree)}`
  );
  const importedUnclosedVariationTree = moveImport.extractUciMoveTree(`
    [Variant "Xiangqi"]
    1. b2e2 h9g7 (1... b9c7
  `);
  assert(
    importedUnclosedVariationTree.moves.join(" ") === "b2e2 h9g7",
    `PGN import should recover the stable mainline from an unclosed variation, got: ${JSON.stringify(importedUnclosedVariationTree)}`
  );
  assert(
    importedUnclosedVariationTree.hasVariations &&
      importedUnclosedVariationTree.moveTree[0]?.children?.[1]?.uci === "b9c7",
    `PGN import should keep an unclosed variation visible, got: ${JSON.stringify(importedUnclosedVariationTree)}`
  );
  const importedNestedVariationTree = moveImport.extractUciMoveTree(`
    [Variant "Xiangqi"]
    1. b2e2 h9g7 (1... b9c7)
  `);
  assert(
    importedNestedVariationTree.moveTree[0]?.children?.[0]?.uci === "h9g7" &&
      importedNestedVariationTree.moveTree[0]?.children?.[1]?.uci === "b9c7",
    `PGN variation tree import should preserve alternate replies, got: ${JSON.stringify(importedNestedVariationTree)}`
  );

  const promotedChessMove = moveImport.extractUciMoveLine(`
    [Variant "Xiangqi"]
    1. b2e2q
  `);
  assert(
    promotedChessMove.length === 0,
    `Xiangqi import should reject chess-style promotion suffixes, got: ${promotedChessMove.join(" ")}`
  );

  assert(
    moveNotation.formatUciMove("b2e2q") === "B2E2Q",
    "Move formatter should not hide malformed suffixes as legal Xiangqi moves."
  );
  assert(
    moveNotation.formatUciLine(["b2e2", "h9g7", "b0c2"], 2) === "B2→E2 H9→G7 +1",
    "Move line formatter should mark hidden continuation moves."
  );

  const beginnerChoice = aiOpponent.chooseAiMoveFromPv({
    fallbackMove: "h0g2",
    fallbackScore: 50,
    pvLines: [
      { score: 50, moves: ["h0g2"], multipv: 0, searchTag: "ai-test" },
      { score: 10, moves: ["b0c2"], multipv: 1, searchTag: "ai-test" },
    ],
    searchTag: "ai-test",
    strength: 1,
    random: () => 0.99,
  });
  assert(beginnerChoice.move === "b0c2", "Beginner AI should still be able to choose a legal lower-ranked PV candidate.");

  const suffixedCandidateChoice = aiOpponent.chooseAiMoveFromPv({
    fallbackMove: "h0g2",
    fallbackScore: 50,
    pvLines: [
      { score: 50, moves: ["h0g2"], multipv: 0, searchTag: "ai-test" },
      { score: 10, moves: ["b0c2q"], multipv: 1, searchTag: "ai-test" },
    ],
    searchTag: "ai-test",
    strength: 1,
    random: () => 0.99,
  });
  assert(suffixedCandidateChoice.move === "h0g2", "AI candidate selection should ignore suffixed non-Xiangqi moves.");

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
