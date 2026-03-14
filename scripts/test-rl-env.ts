/**
 * Test suite for the Xiangqi RL environment.
 * Run with: npx tsx scripts/test-rl-env.ts
 */
import {
    XiangqiEnv,
    RandomAgent,
    GreedyAgent,
    runEpisode,
    runSelfPlay,
    actionToUci,
    uciToAction,
    encodeAction,
    decodeAction,
    ACTION_SPACE_SIZE,
    OBS_SIZE,
    NUM_CHANNELS,
    BOARD_RANKS,
    BOARD_FILES,
} from "../src/rl/index";

// ─── tiny test harness ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${name}`);
        console.error(`      ${msg}`);
        failed++;
    }
}

function assert(cond: boolean, msg = "assertion failed"): void {
    if (!cond) throw new Error(msg);
}

function assertEqual<T>(a: T, b: T, msg?: string): void {
    if (a !== b) throw new Error(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertClose(a: number, b: number, eps = 1e-6, msg?: string): void {
    if (Math.abs(a - b) > eps) {
        throw new Error(msg ?? `expected ~${b}, got ${a}`);
    }
}

// ─── action encoding ──────────────────────────────────────────────────────────

console.log("\nAction encoding");

test("encodeAction / decodeAction roundtrip", () => {
    for (const [f, t] of [[0, 0], [0, 89], [89, 0], [44, 55], [89, 89]]) {
        const action = encodeAction(f, t);
        const { fromSq, toSq } = decodeAction(action);
        assertEqual(fromSq, f, `fromSq mismatch for (${f},${t})`);
        assertEqual(toSq,   t, `toSq mismatch for (${f},${t})`);
    }
});

test("uciToAction / actionToUci roundtrip", () => {
    for (const uci of ["e0e1", "a0i9", "d7f5", "b2c4"]) {
        const action = uciToAction(uci);
        assert(action >= 0, `uciToAction("${uci}") returned -1`);
        const back = actionToUci(action);
        assertEqual(back, uci, `roundtrip mismatch for "${uci}"`);
    }
});

test("ACTION_SPACE_SIZE constant", () => {
    assertEqual(ACTION_SPACE_SIZE, 90 * 90);
});

test("invalid UCI returns -1", () => {
    assertEqual(uciToAction("zz00"), -1);
    assertEqual(uciToAction(""),     -1);
});

// ─── observation space ────────────────────────────────────────────────────────

console.log("\nObservation space");

test("observation size constants", () => {
    assertEqual(OBS_SIZE, NUM_CHANNELS * BOARD_RANKS * BOARD_FILES);
    assertEqual(OBS_SIZE, 15 * 10 * 9);
});

test("reset returns correct-length Float32Array", () => {
    const env = new XiangqiEnv();
    const obs = env.reset();
    assert(obs instanceof Float32Array, "obs is not Float32Array");
    assertEqual(obs.length, OBS_SIZE);
});

test("observation values are 0 or 1", () => {
    const env = new XiangqiEnv();
    const obs = env.reset();
    for (let i = 0; i < obs.length; i++) {
        assert(obs[i] === 0 || obs[i] === 1, `obs[${i}] = ${obs[i]} is not 0 or 1`);
    }
});

test("starting position has 32 pieces on the board", () => {
    const env = new XiangqiEnv();
    const obs = env.reset();
    // Channels 0–13 encode piece positions; channel 14 is side-to-move.
    let pieceCount = 0;
    for (let i = 0; i < 14 * BOARD_RANKS * BOARD_FILES; i++) {
        pieceCount += obs[i];
    }
    assertEqual(pieceCount, 32, `expected 32 pieces, got ${pieceCount}`);
});

test("side-to-move channel is all-1 for red at start", () => {
    const env = new XiangqiEnv();
    const obs = env.reset();
    const start = 14 * BOARD_RANKS * BOARD_FILES;
    for (let i = start; i < start + BOARD_RANKS * BOARD_FILES; i++) {
        assertEqual(obs[i], 1, `channel 14 at index ${i} should be 1 (red to move)`);
    }
});

// ─── environment API ──────────────────────────────────────────────────────────

console.log("\nEnvironment API");

test("initial side to move is red ('w')", () => {
    const env = new XiangqiEnv();
    env.reset();
    assertEqual(env.currentSide, "w");
});

test("legalActions returns non-empty array at start", () => {
    const env = new XiangqiEnv();
    env.reset();
    const actions = env.legalActions();
    assert(actions.length > 0, "no legal actions at start");
});

test("all legalActions are valid action integers", () => {
    const env = new XiangqiEnv();
    env.reset();
    for (const a of env.legalActions()) {
        assert(a >= 0 && a < ACTION_SPACE_SIZE, `action ${a} out of range`);
    }
});

test("standard start position has 44 legal moves for red", () => {
    const env = new XiangqiEnv();
    env.reset();
    const actions = env.legalActions();
    assertEqual(actions.length, 44, `expected 44 moves, got ${actions.length}`);
});

test("step advances ply and changes side to move", () => {
    const env = new XiangqiEnv();
    env.reset();
    assertEqual(env.currentPly, 0);
    const action = env.legalActions()[0];
    env.step(action);
    assertEqual(env.currentPly, 1);
    assertEqual(env.currentSide, "b");
});

test("step returns observation of correct length", () => {
    const env = new XiangqiEnv();
    env.reset();
    const { observation } = env.step(env.legalActions()[0]);
    assert(observation instanceof Float32Array);
    assertEqual(observation.length, OBS_SIZE);
});

test("reward is 0 on non-terminal step", () => {
    const env = new XiangqiEnv();
    env.reset();
    const { reward, done } = env.step(env.legalActions()[0]);
    assertClose(reward, 0);
    assertEqual(done, false);
});

test("done is false after first move", () => {
    const env = new XiangqiEnv();
    env.reset();
    const { done } = env.step(env.legalActions()[0]);
    assertEqual(done, false);
});

test("step throws on illegal action", () => {
    const env = new XiangqiEnv();
    env.reset();
    // action 0 = fromSq 0 → toSq 0 (same square) – always illegal
    let threw = false;
    try { env.step(0); } catch { threw = true; }
    assert(threw, "expected step(0) to throw");
});

test("step throws after episode ends", () => {
    const env = new XiangqiEnv({ maxPly: 1 });
    env.reset();
    env.step(env.legalActions()[0]);
    assert(env.done, "expected env.done after maxPly=1");
    let threw = false;
    try { env.step(env.legalActions()[0] ?? 0); } catch { threw = true; }
    assert(threw, "expected throw when stepping after done");
});

test("reset clears done state", () => {
    const env = new XiangqiEnv({ maxPly: 1 });
    env.reset();
    env.step(env.legalActions()[0]);
    assert(env.done);
    env.reset();
    assert(!env.done, "done should be false after reset");
});

test("env.fen changes after a move", () => {
    const env = new XiangqiEnv();
    const fenBefore = env.fen;
    env.reset();
    env.step(env.legalActions()[0]);
    assert(env.fen !== fenBefore, "FEN should change after a move");
});

// ─── maxPly draw ──────────────────────────────────────────────────────────────

console.log("\nTermination conditions");

test("maxPly=2 ends after 2 plies with draw", () => {
    const env = new XiangqiEnv({ maxPly: 2 });
    env.reset();
    env.step(env.legalActions()[0]);
    const { done, reward, info } = env.step(env.legalActions()[0]);
    assertEqual(done,   true);
    assertClose(reward, 0);
    assertEqual(info.termination, "draw_moves");
});

// ─── agents ───────────────────────────────────────────────────────────────────

console.log("\nAgents");

test("RandomAgent selects a legal action", () => {
    const env   = new XiangqiEnv();
    env.reset();
    const agent = new RandomAgent();
    const legal = env.legalActions();
    const act   = agent.selectAction(env.observation, legal);
    assert(legal.includes(act), `RandomAgent selected unlisted action ${act}`);
});

test("GreedyAgent selects action with highest score", () => {
    const env    = new XiangqiEnv();
    env.reset();
    const legal  = env.legalActions();
    const scores = new Map(legal.map((a, i) => [a, i])); // score = position index
    const agent  = new GreedyAgent((_obs, action) => scores.get(action) ?? -1);
    const act    = agent.selectAction(env.observation, legal);
    assertEqual(act, legal[legal.length - 1], "GreedyAgent should pick last (highest-scored) action");
});

// ─── runEpisode ───────────────────────────────────────────────────────────────

console.log("\nrunEpisode");

test("runEpisode completes with two RandomAgents", () => {
    const env    = new XiangqiEnv({ maxPly: 50 });
    const agent  = new RandomAgent();
    const result = runEpisode(env, agent, agent);
    assert(["red", "black", "draw"].includes(result.outcome));
    assert(result.ply > 0);
    assert(typeof result.termination === "string");
});

test("runEpisode with collectTransitions=true has non-empty transitions", () => {
    const env    = new XiangqiEnv({ maxPly: 10 });
    const agent  = new RandomAgent();
    const result = runEpisode(env, agent, agent, true);
    assertEqual(result.transitions.length, result.ply);
});

test("runEpisode with collectTransitions=false has empty transitions", () => {
    const env    = new XiangqiEnv({ maxPly: 10 });
    const agent  = new RandomAgent();
    const result = runEpisode(env, agent, agent, false);
    assertEqual(result.transitions.length, 0);
});

test("transition observations have correct shape", () => {
    const env    = new XiangqiEnv({ maxPly: 10 });
    const agent  = new RandomAgent();
    const result = runEpisode(env, agent, agent, true);
    for (const t of result.transitions) {
        assertEqual(t.observation.length,     OBS_SIZE);
        assertEqual(t.nextObservation.length, OBS_SIZE);
    }
});

// ─── runSelfPlay ──────────────────────────────────────────────────────────────

console.log("\nrunSelfPlay");

test("runSelfPlay returns correct episode count", () => {
    const env   = new XiangqiEnv({ maxPly: 20 });
    const agent = new RandomAgent();
    const stats = runSelfPlay(env, agent, agent, 5);
    assertEqual(stats.episodes, 5);
});

test("runSelfPlay: redWins + blackWins + draws = episodes", () => {
    const env   = new XiangqiEnv({ maxPly: 30 });
    const agent = new RandomAgent();
    const stats = runSelfPlay(env, agent, agent, 10);
    assertEqual(stats.redWins + stats.blackWins + stats.draws, 10);
});

test("runSelfPlay avgPly is positive", () => {
    const env   = new XiangqiEnv({ maxPly: 30 });
    const agent = new RandomAgent();
    const stats = runSelfPlay(env, agent, agent, 5);
    assert(stats.avgPly > 0, `avgPly should be positive, got ${stats.avgPly}`);
});

test("onEpisodeDone callback fires for each episode", () => {
    const env   = new XiangqiEnv({ maxPly: 10 });
    const agent = new RandomAgent();
    let count   = 0;
    runSelfPlay(env, agent, agent, 7, () => { count++; });
    assertEqual(count, 7);
});

// ─── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
