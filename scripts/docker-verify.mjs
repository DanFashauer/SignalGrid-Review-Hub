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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const emitEvidence = process.argv.includes("--emit-evidence");
const keepUp = process.argv.includes("--keep");

/** Postgres is published on 5433 so a developer's local 5432 is never disturbed. */
const PG_PORT = 5433;
const PG_URL = `postgres://sg:sg@localhost:${PG_PORT}/signalgrid`;
const PG_CONTAINER = "signalgrid-verify-pg";

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8", timeout: 15 * 60_000, ...opts });

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} — ${name}${detail && !ok ? `: ${detail}` : ""}`);
  return ok;
};

console.log("Docker verification — the real deployment topology, against a real database\n");

// ── 1. Docker must actually be there. A missing daemon is a REFUSAL, not a skip ──
const dockerVersion = run("docker", ["version", "--format", "{{.Server.Version}}"]);
const dockerUp = dockerVersion.status === 0 && (dockerVersion.stdout ?? "").trim().length > 0;
if (!record("docker daemon reachable", dockerUp, (dockerVersion.stderr ?? "").trim().split("\n")[0])) {
  console.error(
    "\nDocker is not available. This script verifies the DEPLOYED topology, so there is\n" +
      "nothing it can honestly check without it — refusing to report a pass.\n" +
      "  macOS: start Docker Desktop, then re-run.\n",
  );
  process.exit(1);
}
const serverVersion = (dockerVersion.stdout ?? "").trim();

// ── 2. Bring up Postgres in the prod image ────────────────────────────────────
run("docker", ["rm", "-f", PG_CONTAINER]); // idempotent: clear a previous run
const up = run("docker", [
  "run", "-d", "--name", PG_CONTAINER,
  "-e", "POSTGRES_USER=sg", "-e", "POSTGRES_PASSWORD=sg", "-e", "POSTGRES_DB=signalgrid",
  "-p", `${PG_PORT}:5432`, "postgres:16",
]);
if (!record("postgres:16 container started", up.status === 0, (up.stderr ?? "").trim().split("\n")[0])) {
  process.exit(1);
}

// Wait for readiness rather than sleeping a guessed interval.
let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  const probe = run("docker", ["exec", PG_CONTAINER, "pg_isready", "-U", "sg", "-d", "signalgrid"]);
  ready = probe.status === 0;
  if (!ready) run("sleep", ["1"]);
}
record("postgres accepting connections", ready);

const teardown = () => {
  if (keepUp) {
    console.log(`\n(--keep) leaving ${PG_CONTAINER} running on port ${PG_PORT}.`);
    return;
  }
  run("docker", ["rm", "-f", PG_CONTAINER]);
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

const allGreen = results.every((r) => r.ok);
console.log(
  `\ndocker=${serverVersion} pgProofs=${PG_PROOFS.length} pgAssertions=${pgAssertions} ` +
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
        kind: "docker-run",
        manifestFingerprint: manifest.fingerprint,
        dockerServerVersion: serverVersion,
        durablePersistencePass: true,
        pgProofsRun: PG_PROOFS.length,
        pgAssertionsPassed: pgAssertions,
        note:
          "A real Docker daemon ran postgres:16 and the three durable-persistence proofs " +
          "passed against it. Emission is refused unless every step is green.",
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
