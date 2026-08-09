#!/usr/bin/env node
// Docker verification lane — run the product's REAL deployment topology and prove
// the durable half against an actual database.
//
//   node scripts/docker-verify.mjs                  # bring the stack up, verify, tear down
//   node scripts/docker-verify.mjs --emit-evidence  # ...and write committable evidence
//   node scripts/docker-verify.mjs --keep           # leave the stack running afterwards
//
// WHY THIS EXISTS. Every other gate in this repo runs the decision core in-memory.
// That proves the logic and nothing about the deployment: the audit ledger's
// tamper-evidence, the decision/evidence store's tenant isolation, and the session
// lifecycle only become REAL claims when they run against Postgres over a socket,
// in the topology docker-compose.prod.yml actually deploys. CI runs those three
// proofs, but CI is not a place a person can look at; this makes the same run
// reproducible on any machine with Docker, which is what "we tested it" should mean.
//
// It is the Docker sibling of `verify-all.mjs --emit-evidence` (docs/LIVE_SYNC_LOOP.md)
// and inherits that file's central discipline: EVIDENCE IS NEVER FABRICATED.
// Emission is refused unless Docker really ran, the containers really came up, and
// every assertion really passed. A skipped step, an unreachable daemon, or a red
// proof mints nothing — a green-looking artifact over a run that did not happen is
// worse than no artifact, because it launders an assumption into a record.
//
// Public-safe by construction: the emitted file carries fingerprints, booleans and
// counts only — no hostnames, usernames, paths, or timestamps.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveContainerEngine, describeEngine } from "./lib/container-engine.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const emitEvidence = process.argv.includes("--emit-evidence");
const keepUp = process.argv.includes("--keep");

// Images are named WITH their registry. `postgres:16` is not a name, it is a lookup
// against whatever search list the engine happens to be configured with — Docker
// silently implies docker.io, Podman refuses outright ("short-name did not resolve
// to an alias"). Relying on an implicit default means the registry an image comes
// from is decided by host config rather than by this file, which is the wrong place
// for a supply-chain decision. Fully-qualified works identically on both engines.
const PG_IMAGE = "docker.io/library/postgres:16";
const REDIS_IMAGE = "docker.io/library/redis:7";

/** Postgres is published on 5433 so a developer's local 5432 is never disturbed. */
const PG_PORT = 5433;
const PG_URL = `postgres://sg:sg@localhost:${PG_PORT}/signalgrid`;
const PG_CONTAINER = "signalgrid-verify-pg";

/** Redis on 6380 for the same reason. It backs the credential store, whose
 *  concurrency claim is only testable against a real shared store. */
const REDIS_PORT = 6380;
const REDIS_URL = `redis://127.0.0.1:${REDIS_PORT}`;
const REDIS_CONTAINER = "signalgrid-verify-redis";

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8", timeout: 15 * 60_000, ...opts });

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} — ${name}${detail && !ok ? `: ${detail}` : ""}`);
  return ok;
};

console.log("Container verification — the real deployment topology, against a real database\n");

// ── 1. An engine must actually be there. A missing one is a REFUSAL, not a skip ──
//
// Engine-agnostic on purpose: these are OCI images built from ordinary Dockerfiles,
// so docker and podman both run them. Which one answered is RECORDED rather than
// assumed — "docker daemon reachable" printed while podman did the work would be a
// false statement about how the evidence was produced.
const resolved = resolveContainerEngine();
if (!record(`container engine reachable — ${describeEngine(resolved)}`, resolved.ok)) {
  console.error(
    `\n${resolved.detail}\n\n` +
      "This script verifies the DEPLOYED topology, so there is nothing it can honestly\n" +
      "check without an engine — refusing to report a pass.\n",
  );
  process.exit(1);
}
const ENGINE = resolved.engine;
const serverVersion = resolved.version;

// ── 2. Bring up Postgres in the prod image ────────────────────────────────────
run(ENGINE, ["rm", "-f", PG_CONTAINER]); // idempotent: clear a previous run
const up = run(ENGINE, [
  "run", "-d", "--name", PG_CONTAINER,
  "-e", "POSTGRES_USER=sg", "-e", "POSTGRES_PASSWORD=sg", "-e", "POSTGRES_DB=signalgrid",
  "-p", `${PG_PORT}:5432`, PG_IMAGE,
]);
if (!record("postgres:16 container started", up.status === 0, (up.stderr ?? "").trim().split("\n")[0])) {
  process.exit(1);
}

// Wait for readiness rather than sleeping a guessed interval.
let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  const probe = run(ENGINE, ["exec", PG_CONTAINER, "pg_isready", "-U", "sg", "-d", "signalgrid"]);
  ready = probe.status === 0;
  if (!ready) run("sleep", ["1"]);
}
record("postgres accepting connections", ready);

// ── 2b. Redis, for the credential store's concurrency claim ───────────────────
run(ENGINE, ["rm", "-f", REDIS_CONTAINER]);
const redisUp = run(ENGINE, [
  "run", "-d", "--name", REDIS_CONTAINER, "-p", `${REDIS_PORT}:6379`, REDIS_IMAGE,
]);
record("redis:7 container started", redisUp.status === 0, (redisUp.stderr ?? "").trim().split("\n")[0]);

let redisReady = false;
for (let i = 0; i < 60 && !redisReady; i += 1) {
  const probe = run(ENGINE, ["exec", REDIS_CONTAINER, "redis-cli", "ping"]);
  redisReady = probe.status === 0 && (probe.stdout ?? "").includes("PONG");
  if (!redisReady) run("sleep", ["1"]);
}
record("redis accepting connections", redisReady);

const teardown = () => {
  if (keepUp) {
    console.log(`\n(--keep) leaving ${PG_CONTAINER} on ${PG_PORT} and ${REDIS_CONTAINER} on ${REDIS_PORT}.`);
    return;
  }
  run(ENGINE, ["rm", "-f", PG_CONTAINER]);
  run(ENGINE, ["rm", "-f", REDIS_CONTAINER]);
};

if (!ready) {
  teardown();
  process.exit(1);
}

// ── 3. The durable half, against the real database ────────────────────────────
// These are the three proofs whose claims are ONLY meaningful over a real socket:
// durability across a reconnect, tamper-evidence of the ledger chain, tenant
// isolation enforced by the store rather than by a test harness, and concurrency.
const PG_PROOFS = [
  ["proof:audit-ledger-pg", "durable audit ledger (durability, tamper-evidence, redaction, concurrency)"],
  ["proof:decision-store-pg", "durable decision + evidence store (isolation, tamper-evident snapshots)"],
  ["proof:session-store-pg", "durable session lifecycle (start/refresh/expire/end, isolation)"],
];
let pgAssertions = 0;
for (const [script, what] of PG_PROOFS) {
  const r = run("pnpm", ["run", script], { env: { ...process.env, DATABASE_URL: PG_URL } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // Count only what the proof itself reports — never infer a number from exit status.
  const m = out.match(/(\d+)\/(\d+) assertions passed/);
  const ok = r.status === 0 && !!m && m[1] === m[2];
  if (ok) pgAssertions += Number(m[1]);
  record(`${script} — ${what}`, ok, out.trim().split("\n").slice(-1)[0]);
}

// ── 3b. The credential store's concurrency claim, against a real Redis ────────
// addCredential must not lose an enrollment when ceremonies overlap. That claim is
// only testable against a real shared store — in-memory single-process mode cannot
// exhibit the race at all, so a green unit suite says nothing about it.
let raceAssertions = 0;
if (redisReady) {
  const r = run("pnpm", ["run", "proof:enrollment-race"], {
    env: { ...process.env, REDIS_URL },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = out.match(/(\d+)\/(\d+) assertions passed/);
  const ok = r.status === 0 && !!m && m[1] === m[2];
  if (ok) raceAssertions = Number(m[1]);
  record("proof:enrollment-race — concurrent enrollment loses no credential", ok, out.trim().split("\n").slice(-1)[0]);
}

const allGreen = results.every((r) => r.ok);
console.log(
  `\nengine=${ENGINE} version=${serverVersion} pgProofs=${PG_PROOFS.length} pgAssertions=${pgAssertions} ` +
    `raceAssertions=${raceAssertions} ` +
    `result=${allGreen ? "pass" : "fail"}`,
);

// ── 4. Evidence, emitted only over a run that really happened ─────────────────
if (emitEvidence) {
  if (!allGreen) {
    console.error(
      "\n--emit-evidence: REFUSED — the run was not fully green. A red or partial run\n" +
        "must never mint evidence; that is the whole point of the artifact.",
    );
  } else {
    const manifestPath = resolve(repoRoot, "artifacts/sync/live-sync-manifest.json");
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    if (!manifest?.fingerprint) {
      console.error(
        "\n--emit-evidence: REFUSED — artifacts/sync/live-sync-manifest.json is missing or\n" +
          "unreadable, so the evidence could not be tied to the contracts it validated.",
      );
    } else {
      const evidenceDir = resolve(repoRoot, "artifacts/live-evidence");
      mkdirSync(evidenceDir, { recursive: true });
      // Public-safe by construction: fingerprints, booleans and counts only.
      const evidence = {
        kind: "container-run",
        manifestFingerprint: manifest.fingerprint,
        // WHICH engine, not just which version. An evidence file that says only
        // "dockerServerVersion" while podman did the work misdescribes its own
        // provenance, and provenance is the entire value of the artifact.
        containerEngine: ENGINE,
        containerEngineVersion: serverVersion,
        durablePersistencePass: true,
        pgProofsRun: PG_PROOFS.length,
        pgAssertionsPassed: pgAssertions,
        enrollmentRaceAssertionsPassed: raceAssertions,
        note:
          `A real container engine (${ENGINE} ${serverVersion}) ran postgres:16 and redis:7; ` +
          "the three durable-persistence proofs and the concurrent-enrollment race proof " +
          "passed against them. Emission is refused unless every step is green.",
      };
      const path = resolve(evidenceDir, "docker-run.json");
      writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(`\n--emit-evidence: wrote ${path} (manifestFingerprint=${manifest.fingerprint.slice(0, 12)}…).`);
      console.log("Commit artifacts/live-evidence/ — that commit IS the record that a real stack ran.");
    }
  }
}

teardown();
process.exit(allGreen ? 0 : 1);
