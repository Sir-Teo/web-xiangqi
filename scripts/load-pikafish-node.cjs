const fs = require("fs");
const os = require("os");
const path = require("path");

function exactVariantForNode(requestedVariant) {
  const requested = String(requestedVariant || "threaded").trim();
  if (requested === "auto") return "threaded-simd";
  if (requested === "single" || requested === "single-simd" || requested === "threaded" || requested === "threaded-simd") {
    return requested;
  }
  throw new Error(`Unsupported Pikafish variant: ${requested}`);
}

function coreJsFileForVariant(variant) {
  switch (variant) {
    case "single":
      return "pikafish-core-single.js";
    case "single-simd":
      return "pikafish-core-single-simd.js";
    case "threaded-simd":
      return "pikafish-core-simd.js";
    case "threaded":
      return "pikafish-core.js";
    default:
      throw new Error(`Unsupported Pikafish variant: ${variant}`);
  }
}

function copyAsCjs(srcPath, label) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`${srcPath} not found. Build first.`);
  }
  const outPath = path.join(os.tmpdir(), `${label}-${process.pid}.cjs`);
  fs.copyFileSync(srcPath, outPath);
  return outPath;
}

function loadPikafishNode(distDir, requestedVariant, label = "pikafish-node") {
  const variant = exactVariantForNode(requestedVariant);
  const wrapperPath = copyAsCjs(path.join(distDir, "pikafish.js"), `${label}-wrapper`);
  const corePath = copyAsCjs(path.join(distDir, coreJsFileForVariant(variant)), `${label}-core-${variant}`);
  return {
    variant,
    createPikafish: require(wrapperPath),
    coreFactory: require(corePath),
  };
}

module.exports = {
  loadPikafishNode,
};
