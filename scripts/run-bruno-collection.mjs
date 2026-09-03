#!/usr/bin/env node
// Bruno collection live run — the contract plane actually executed.
//
// The static gate (scripts/check-api-collection.mjs) proves the collection and
// the registered routes agree ON PAPER, in both directions. This runner proves
// the paper against a RUNNING server: it boots the built api-server exactly
// the way test/api.test.mjs does (same port, same in-memory demo core, same
// intentionally-public sgk_demo_* fixtures), executes the collection with the
// real Bruno CLI, and fails on any request error, any 5xx, or any failed
// Bruno assertion.
//
// Two passes, because the profile fence is real:
//   pass A — SIGNALGRID_PRODUCT_PROFILE=review-demo: health/, v1/,
//            control-plane/, review-demo/ (the fenced routes SERVE here).
//   pass B — SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway:
//            negative-tests/ (the fence 404 and the refusals prove here —
//            a passing negative test is a refusal happening on schedule).
// sources/ is DELIBERATELY not run: those requests target the external lab
// services run-live-lanes.sh starts, not the api-server — the Mac lane runs
// them against a live lab via the sim-request loop.
//
// Success criteria per pass, read from Bruno's JSON results file:
//   - every request completed (no transport error),
//   - no response carries status >= 500 (a plain request without asserts must
//     still not crash the server),
//   - every explicit assertion/test passed.
// Results land under artifacts/bruno/ (gitignored — a CI artifact and a local
// record, not a committed claim; committed evidence flows through the
// sim-results loop with provenance).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(new URL(".", import.meta.url).pathname, "..");
const COLLECTION = resolve(repo, "artifacts/api-collection");
const BRU = resolve(repo, "scripts/node_modules/.bin/bru");
const SERVER = resolve(repo, "artifacts/api-server/dist/index.mjs");
const OUT_DIR = resolve(repo, "artifacts/bruno");
const PORT = 5310;

function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`http://localhost:${PORT}/api/healthz`);
        if (res.ok) return resolveWait();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error("server did not answer /healthz in time"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function runBru(target, outFile) {
  // ONE target (folder or single .bru file) per invocation: bru 4.0.0
  // silently honours only part of a multi-path argument list — a run that
  // looked green once covered 26 of 79 requests because the last folder was
  // dropped. The caller aggregates across invocations instead.
  // bru exits non-zero on failed assertions; we ALSO parse the results file
  // because a plain request with no asserts can fail (5xx) without failing
  // the run — trust the data, not only the exit code. --reporter-skip-*
  // keeps bodies/headers out of the file: it is a pass/fail record, not a
  // data capture.
  // -r: a folder target runs its subfolders too (review-demo/ is ONLY
  // subfolders and executed zero requests without it — the empty-run check
  // below caught that, which is exactly why it exists).
  const args = ["run", target, "-r", "--env", "Local", "--output", outFile, "--format", "json",
    "--reporter-skip-all-headers", "--reporter-skip-response-body", "--reporter-skip-request-body"];
  const r = spawnSync(BRU, args, { cwd: COLLECTION, encoding: "utf8" });
  return r;
}

function auditResults(outFile, label) {
  const problems = [];
  let data;
  try {
    data = JSON.parse(readFileSync(outFile, "utf8"));
  } catch {
    return [`${label}: results file did not parse — the run itself is unproven`];
  }
  // Bruno's JSON output: array of { iterationIndex, summary, results: [...] }
  // or a flat object with .results depending on version; normalise.
  const runs = Array.isArray(data) ? data : [data];
  let requests = 0;
  for (const run of runs) {
    for (const res of run.results ?? []) {
      requests += 1;
      const name = res.suitename ?? res.test?.filename ?? res.request?.url ?? "unnamed";
      if (res.error) problems.push(`${label}: ${name} — transport error: ${res.error}`);
      const status = res.response?.status;
      if (typeof status === "number" && status >= 500) {
        problems.push(`${label}: ${name} — server error ${status}`);
      }
      for (const a of [...(res.assertionResults ?? []), ...(res.testResults ?? [])]) {
        if (a.status === "fail") problems.push(`${label}: ${name} — ${a.lhsExpr ?? a.description ?? "assertion"} failed: ${a.error ?? ""}`);
      }
    }
  }
  if (requests === 0) problems.push(`${label}: zero requests executed — an empty run must not read as a green one`);
  console.log(`  ${label}: ${requests} request(s) executed, ${problems.length} problem(s)`);
  return problems;
}

async function pass(profile, targets, outPrefix) {
  // EXPLICIT MINIMAL ENV for the child, not `...process.env`. The api-server here
  // runs in fixture mode (in-memory demo core), so it needs only its port, the
  // product profile, and a log level — plus PATH so `node` itself resolves.
  // Forwarding the parent's whole environment handed a public-safe fixture server
  // every ambient secret and credential the runner happened to hold (METRICS_TOKEN,
  // SIGNALGRID_ENROLLMENT_SECRET, any DB URL, …); the harness starts a fixture
  // process and its environment should say exactly that. Omitting SIGNALGRID_TIER
  // and SIGNALGRID_LIVE_INTEGRATIONS is deliberate: tier then resolves to "dev",
  // which can never make a live vendor call — the fixture-safe direction.
  const server = spawn("node", ["--enable-source-maps", SERVER], {
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(PORT),
      SIGNALGRID_PRODUCT_PROFILE: profile,
      LOG_LEVEL: "silent",
    },
    stdio: "ignore",
  });
  const problems = [];
  try {
    await waitForServer();
    for (const target of targets) {
      const outFile = resolve(OUT_DIR, `${outPrefix}-${target.replaceAll("/", "_").replace(".bru", "")}.json`);
      rmSync(outFile, { force: true });
      const r = runBru(target, outFile);
      const found = auditResults(outFile, `${profile} ${target}`);
      problems.push(...found);
      if (r.status !== 0 && found.length === 0) {
        problems.push(`${profile} ${target}: bru exited ${r.status} but the results file shows no failure — refusing to guess, treating as failed`);
      }
    }
    return problems;
  } finally {
    server.kill("SIGTERM");
  }
}

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const build = spawnSync("pnpm", ["--filter", "@workspace/api-server", "run", "build"], { cwd: repo, stdio: "ignore" });
  if (build.status !== 0) {
    console.error("api-server build failed — cannot run the collection against nothing");
    process.exit(1);
  }
  console.log("Bruno collection live run — the committed contract, executed");
  // The token-dependent negative tests (cross-tenant 404, malformed 400) run
  // under review-demo, where the sgk_demo_* fixtures authenticate — under the
  // gateway profile every demo bearer is refused outright (verified live:
  // both answered 401 before their real check could fire). The gateway pass
  // keeps exactly the two that prove there: the profile fence 404 and the
  // no-token 401.
  const problems = [
    ...(await pass("review-demo", [
      "health", "v1", "control-plane", "review-demo",
      // The adversarial-trust folder: every request proves a refusal,
      // a tightening, or a correctly-scoped replay — the "no unearned
      // affirmative" doctrine executed on the wire. Order matters for the
      // replay pair (same-body stores, different-body must miss), and bru
      // runs a folder in seq order, which is why they carry seq 12/13.
      "adversarial-trust",
      "negative-tests/cross-tenant-decision.bru",
      "negative-tests/malformed-evaluate.bru",
    ], "review-demo")),
    ...(await pass("shared-device-gateway", [
      "negative-tests/gateway-fence-demo-route.bru",
      "negative-tests/unauthenticated-context.bru",
    ], "gateway")),
  ];
  if (problems.length > 0) {
    console.error(`Bruno live run FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("Bruno live run passed — every request executed, no server errors, every assertion held.");
};

main();
