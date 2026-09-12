"use strict";

const metrics = ["avgNps", "avgWallMs", "coldStartMs"];

function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline) ||
      !Number.isInteger(baseline.depth) || baseline.depth <= 0 ||
      metrics.some(key => !Number.isFinite(baseline[key]) || baseline[key] < 0)) {
    throw new Error("Invalid benchmark comparison: expected a snapshot saved with --out, with a positive depth and finite, nonnegative avgNps, avgWallMs and coldStartMs.");
  }
  return baseline;
}

function compareSnapshots(snapshot, baseline) {
  validateBaseline(baseline);
  const read = (source, key) => key.split(".").reduce((value, part) => value?.[part], source);
  const fields = keys => keys.map(field => {
    const before = read(baseline, field) ?? null;
    const after = read(snapshot, field) ?? null;
    const known = before !== null && before !== "" && after !== null && after !== "";
    return { field, before, after, status: !known ? "unknown" : before === after ? "same" : "different" };
  });
  const workload = fields(["fen", "depth"]);
  const workloadStatus = workload.some(item => item.status === "different") ? "different"
    : workload.some(item => item.status === "unknown") ? "unknown" : "same";
  const context = fields([
    "resolvedVariant", "threads", "hashMB", "warmup", "repeats", "engineName",
    "nodeVersion", "platform", "arch", "cpuCount",
    ...["wrapper", "coreJs", "coreWasm", "network"].map(name => `artifacts.${name}.sha256`),
  ]).filter(item => item.status !== "same");
  const deltas = Object.fromEntries(metrics.map(key => [key,
    (key === "coldStartMs" || workloadStatus === "same") && baseline[key] > 0 && Number.isFinite(snapshot[key])
      ? (snapshot[key] - baseline[key]) / baseline[key] : null,
  ]));
  return { workloadStatus, workload, context, deltas };
}

module.exports = { compareSnapshots, validateBaseline };
