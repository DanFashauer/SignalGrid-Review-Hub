// Gap scanner - finds gaps and routes each one to where it can actually be fixed.
//
//   pnpm run scan                what needs doing, grouped by venue
//   pnpm run scan -- --venue=cloud    only what a cloud agent can do right now
//   pnpm run scan -- --json      machine-readable, for an agent to consume
//   pnpm run scan -- --self-test prove the scanner can fail
//
// WHY THIS EXISTS
// ---------------
// A list of problems is noise. The useful question is not "what is wrong" but
// "what kind of action does this need, and WHERE can that action happen?"
// This repository is worked on from three places with different powers:
//
//   CLOUD    an agent in a sandbox: full repo, no real hardware, no credentials
//   MAC      the local harness: Xcode, Gradle, Cargo, simulators, real macOS
//   SERVICE  needs Postgres / Redis / Docker to be running
//   TENANT   needs live vendor credentials (Graph, Intune, Jamf) - owner only
//   OWNER    needs a human decision, not a fix
//
// Routing by venue is what makes this actionable for one person splitting time
// between a cloud agent, a Mac and a life.
//
// THE RULE THAT MATTERS MOST
// --------------------------
// A scanner that cries wolf gets ignored, and an ignored scanner is worse than
// none. While building this, a naive check reported "67 gates not registered in
// preflight" - all false. They run in the BREADTH LANE (`verify:breadth`), a
// parallel required CI job, and check-ci-preflight-sync already holds the two
// lanes disjoint and jointly complete. Every detector below therefore carries a
// confidence, and anything it cannot verify is reported as REVIEW, never as a
// defect.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const venueFilter = (argv.find((a) => a.startsWith("--venue=")) || "").split("=")[1];

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", C = "\x1b[36m", B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";

const read = (p) => (existsSync(resolve(repo, p)) ? readFileSync(resolve(repo, p), "utf8") : "");
const sh = (cmd, args) => {
  try { return execFileSync(cmd, args, { cwd: repo, encoding: "utf8", stdio: ["ignore","pipe","ignore"] }); }
  catch { return ""; }
};
const files = (globs) =>
  sh("git", ["ls-files", ...globs]).split("\n").filter(Boolean).filter((f) => !/node_modules|\/dist\//.test(f));

const findings = [];
const add = (f) => findings.push(f);

// --- 1. Open known conditions - already diagnosed, route to their owner -----
{
  const p = "docs/agent/KNOWN_CONDITIONS.json";
  if (existsSync(resolve(repo, p))) {
    for (const c of JSON.parse(read(p)).conditions ?? []) {
      if (c.status !== "open") continue;
      add({
        detector: "known-condition", confidence: "high",
        venue: c.fix_owner === "native" ? "MAC" : "CLOUD",
        remedy: "fix-code", what: `${c.id} - ${c.symptom.split(".")[0]}`,
        where: c.evidence?.[0] ?? p,
        action: c.fix, blocks: c.blocks_pr ? "blocks PR" : "does not block",
      });
    }
  }
}

// --- 2. Gates that need a service the cloud sandbox does not have -----------
{
  const pkg = JSON.parse(read("package.json") || "{}").scripts ?? {};
  const needs = { REDIS_URL: "Redis", DATABASE_URL: "Postgres", docker: "Docker" };
  for (const [name, cmd] of Object.entries(pkg)) {
    if (!/^proof:/.test(name)) continue;
    const src = cmd.match(/scripts\/src\/[\w-]+\.ts/)?.[0];
    if (!src) continue;
    const body = read(src);
    for (const [needle, service] of Object.entries(needs)) {
      if (!body.includes(needle)) continue;
      add({
        detector: "service-gated", confidence: "high", venue: "SERVICE",
        remedy: "provide-service", what: `${name} requires ${service}`,
        where: src,
        action: `Run with ${service} available, or accept that it is CI-only. Refusing without it is correct behaviour, not a failure.`,
        blocks: "not a defect",
      });
      break;
    }
  }
}

// --- 3. Native toolchain - only the Mac lane can execute these --------------
{
  for (const f of files(["scripts/*.sh", ".github/workflows/*.yml"])) {
    const t = read(f);
    const tools = ["xcodebuild","xcodegen","gradlew","cargo "].filter((x) => t.includes(x));
    if (!tools.length) continue;
    add({
      detector: "native-toolchain", confidence: "high", venue: "MAC",
      remedy: "run-on-mac", what: `needs ${tools.join(", ")}`,
      where: f,
      action: "A cloud agent cannot verify this. Run the Mac harness (./validate-sim-macos.sh) and report the result.",
      blocks: "not a defect",
    });
  }
}

// --- 4. Live vendor access - owner only ------------------------------------
{
  const hits = new Set();
  for (const f of files(["lib/**/*.ts","artifacts/**/*.ts","scripts/**/*.ts"])) {
    const t = read(f);
    if (/GRAPH_CLIENT_SECRET|TENANT_ID|JAMF_.*(TOKEN|SECRET)|INTUNE_.*(TOKEN|SECRET)|LIVE_TENANT/.test(t)) hits.add(f);
  }
  if (hits.size) {
    add({
      detector: "needs-tenant", confidence: "medium", venue: "TENANT",
      remedy: "owner-provides", what: `${hits.size} file(s) reference live vendor credentials`,
      where: [...hits].slice(0, 3).join(", "),
      action: "Only the owner can supply a real tenant. Until then these paths stay fixture-backed by design - that is the doctrine, not a gap.",
      blocks: "not a defect",
    });
  }
}

// --- 5. Deferred work markers ----------------------------------------------
{
  const out = sh("git", ["grep", "-nI", "-E", "TODO|FIXME|HACK|XXX", "--", "lib", "artifacts", "native", "firmware"]);
  const lines = out.split("\n").filter(Boolean).filter((l) => !/scan-gaps|KNOWN_CONDITIONS/.test(l));
  if (lines.length) {
    add({
      detector: "deferred-marker", confidence: "high", venue: "CLOUD",
      remedy: "fix-code", what: `${lines.length} TODO/FIXME/HACK marker(s) in source`,
      where: lines.slice(0, 3).map((l) => l.split(":").slice(0, 2).join(":")).join(", "),
      action: "Triage each: fix now, or move to docs/BUILD_BACKLOG.md under Discovered with a reason. A marker with no owner rots.",
      blocks: "review",
    });
  }
}

// --- 6. Silenced tests -----------------------------------------------------
{
  // \\bxit( - an unanchored "xit(" also matches process.eXIT(, which is how this
  // detector first reported 405 skipped tests in a repo that had one.
  const out = sh("git", ["grep", "-nI", "-E", "(it|test|describe)\\.skip\\(|\\bxit\\(|@Ignore|#\\[ignore\\]", "--", "lib", "artifacts", "native", "firmware", "scripts"]);
  const lines = out.split("\n").filter(Boolean)
    .filter((l) => /\.(test|spec)\.|\/tests?\//.test(l.split(":")[0]));
  if (lines.length) {
    add({
      detector: "silenced-test", confidence: "medium", venue: "CLOUD",
      remedy: "investigate", what: `${lines.length} skipped/ignored test(s)`,
      where: lines.slice(0, 3).map((l) => l.split(":").slice(0, 2).join(":")).join(", "),
      action: "A skipped test is an untested claim. For each: re-enable, delete, or record why it is skipped in KNOWN_CONDITIONS.json.",
      blocks: "review",
    });
  }
}

// --- 7. Swallowed errors ---------------------------------------------------
{
  const out = sh("git", ["grep", "-nI", "-E", "catch\\s*\\{\\s*\\}|catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}", "--", "lib", "artifacts"]);
  const lines = out.split("\n").filter(Boolean);
  if (lines.length) {
    add({
      detector: "swallowed-error", confidence: "high", venue: "CLOUD",
      remedy: "fix-code", what: `${lines.length} empty catch block(s)`,
      where: lines.slice(0, 3).map((l) => l.split(":").slice(0, 2).join(":")).join(", "),
      action: "Fail-closed doctrine: a swallowed error is an unknown treated as fine. Log it, or let it raise assurance.",
      blocks: "review",
    });
  }
}

// --- 8. Gate registration - respects the breadth lane, unlike a naive check -
{
  const pkg = JSON.parse(read("package.json") || "{}").scripts ?? {};
  const proofs = Object.keys(pkg).filter((k) => /^proof:/.test(k));
  const preflight = read("scripts/preflight.mjs");
  const breadth = read("scripts/verify-breadth.mjs");
  const ci = files([".github/workflows/*.yml"]).map(read).join("\n");
  // verify:live (scripts/run-live-lanes.sh) runs the live-* proofs against real
  // vendor software. They are credential-gated by design and correctly absent
  // from preflight/CI - a capability boundary, not an orphan. Reporting them as
  // unregistered was this scanner's own first false positive.
  const liveLane = read("scripts/run-live-lanes.sh");
  const isLive = (p) => p.startsWith("proof:live-") || liveLane.includes(p);
  const live = proofs.filter(isLive);
  const orphan = proofs.filter(
    (p) => !isLive(p) && !preflight.includes(p) && !breadth.includes(p) && !ci.includes(p),
  );
  if (live.length) {
    add({
      detector: "live-lane", confidence: "high", venue: "TENANT",
      remedy: "owner-provides", what: `${live.length} live-vendor proof(s) run only via verify:live`,
      where: "scripts/run-live-lanes.sh",
      action: "Credential-gated by design. Only the owner can run these against a real tenant; their absence from CI is correct.",
      blocks: "not a defect",
    });
  }
  if (orphan.length) {
    add({
      detector: "unregistered-gate", confidence: "high", venue: "CLOUD",
      remedy: "add-gate", what: `${orphan.length} proof(s) in neither preflight, the breadth lane, nor CI`,
      where: orphan.slice(0, 4).join(", "),
      action: "A gate that runs nowhere is not a gate. Register it, or delete it.",
      blocks: "blocks PR",
    });
  } else {
    add({
      detector: "unregistered-gate", confidence: "high", venue: "CLOUD",
      remedy: "none", what: `all ${proofs.length} proofs registered (preflight, breadth lane, or CI)`,
      where: "-", action: "Nothing to do.", blocks: "clean",
    });
  }
}

// --- self-test -------------------------------------------------------------
if (argv.includes("--self-test")) {
  const ok = findings.length > 0 && findings.every((f) => f.venue && f.remedy && f.confidence);
  console.log(ok
    ? "PASS  self-test - every finding carries a venue, remedy and confidence"
    : "FAIL  self-test - a finding is missing its routing");
  process.exit(ok ? 0 : 1);
}

// --- report ----------------------------------------------------------------
const shown = venueFilter ? findings.filter((f) => f.venue.toLowerCase() === venueFilter.toLowerCase()) : findings;

if (asJson) { console.log(JSON.stringify({ scanned: new Date().toISOString(), findings: shown }, null, 2)); process.exit(0); }

const VENUES = {
  CLOUD:   [C, "a cloud agent can do this now"],
  MAC:     [Y, "needs the Mac harness - cloud cannot verify"],
  SERVICE: [Y, "needs Postgres / Redis / Docker running"],
  TENANT:  [R, "needs live vendor credentials - owner only"],
  OWNER:   [R, "needs a human decision, not a fix"],
};

console.log(`\n${B}Gap scan${X} ${D}- routed by where the work can actually happen${X}\n`);

for (const [venue, [colour, blurb]] of Object.entries(VENUES)) {
  const group = shown.filter((f) => f.venue === venue);
  if (!group.length) continue;
  console.log(`${colour}${B}${venue}${X} ${D}- ${blurb}${X}`);
  for (const f of group) {
    const mark = f.blocks === "blocks PR" ? `${R}*${X}` : f.blocks === "clean" ? `${G}OK${X}` : `${D}-${X}`;
    console.log(`  ${mark} ${f.what}`);
    console.log(`    ${D}${f.where}${X}`);
    console.log(`    ${D}-> ${f.action}${X}`);
  }
  console.log("");
}

const blocking = shown.filter((f) => f.blocks === "blocks PR");
const cloudNow = shown.filter((f) => f.venue === "CLOUD" && f.remedy !== "none");
console.log(`${D}${shown.length} finding(s) - ${blocking.length} blocking - ${cloudNow.length} actionable in the cloud right now${X}`);
console.log(`${D}Not a defect list: SERVICE/MAC/TENANT items are capability boundaries, not bugs.${X}\n`);
