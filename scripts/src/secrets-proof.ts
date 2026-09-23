// Proof: the secrets seam is ONE door, it fails closed, and it can rotate.
//
// docs/SECRET_MODEL.md (DR-010) says, in its own last section, that no secret manager
// exists, nothing has been migrated, and ROTATION HAS NEVER BEEN EXECUTED. Rule 4's
// acceptance test is "the old credential stops working and nothing else does", and a
// codebase where every consumer reads process.env directly has nowhere to put that
// behaviour: at the instant the operator changes a variable, every caller still
// holding the old value is refused. There is no window.
//
// `@workspace/secrets` is the smallest thing that makes the window real. This proves
// the four properties the rest of the model will be built on:
//
//   1. ONE DOOR, checked and not asserted. No file under artifacts/api-server/src
//      reads a REGISTERED secret off process.env directly. This is the claim that
//      rots first and the only one a scan can keep true.
//   2. FAIL CLOSED. An unconfigured secret matches NOTHING — not the empty string,
//      not a blank presented credential, not a value that happens to be "". A
//      variable set to "" or whitespace reads as unconfigured AND is reported
//      present-but-blank, so a caller can refuse at boot instead of serving open.
//   3. ROTATION, both halves. While a value and its _NEXT are both set, EITHER is
//      accepted; once the old value is replaced by the successor and the successor
//      deleted, the old stops working and the new keeps working. That is rule 4's
//      acceptance test, executed.
//   4. NO VALUE IS LOGGABLE. The printable status carries a fingerprint and never
//      the material; two different values fingerprint differently; and the whole
//      inventory, serialized, contains no secret value.
//
// Direction matters and is enforced: an inbound secret is compared and never read
// out, an outbound one is read out and never compared, and an unregistered name is
// refused outright — a secret nobody declared is a secret no rotation plan covers.
//
// --self-test plants the fail-open claim 2 exists to catch: an unconfigured secret
// that accepts anything.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REGISTRY,
  fingerprint,
  outboundSecret,
  readSecret,
  secretInventory,
  secretMatches,
  secretStatus,
  successorName,
} from "@workspace/secrets";

const SELF_TEST = process.argv.includes("--self-test");
let checks = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  checks += 1;
  if (cond) {
    console.log(`  ok — ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL — ${name}${detail ? `: ${detail}` : ""}`);
  }
}

/** The planted loosening: an unconfigured secret that accepts whatever it is given. */
function matches(name: string, presented: string, env: NodeJS.ProcessEnv): boolean {
  if (SELF_TEST && (env[name] ?? "").trim() === "" && (env[successorName(name)] ?? "").trim() === "") {
    return true;
  }
  return secretMatches(name, presented, env);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The proof runs from scripts/, so paths resolve against the repo root explicitly. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const INBOUND = "METRICS_TOKEN";
const OUTBOUND = "GRAPH_ACCESS_TOKEN";
const CURRENT = "current-value-not-a-real-secret";
const SUCCESSOR = "successor-value-not-a-real-secret";

function main(): void {
  // ── 1. ONE DOOR ────────────────────────────────────────────────────────────
  // A registered name read straight off process.env anywhere in the served source is
  // a second door, and a second door is a place rotation does not reach. Comments are
  // stripped first: a docstring QUOTING the old `process.env.METRICS_TOKEN?.trim()`
  // form is history, not a read, and a scan that cannot tell them apart would force
  // the history to be deleted to keep the gate green.
  const registered = new Set(REGISTRY.map((s) => s.name));
  const offenders: string[] = [];
  const served = walk(join(repoRoot, "artifacts/api-server/src")).filter((f) => f.endsWith(".ts"));
  for (const file of served) {
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const m of src.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*"([A-Z_][A-Z0-9_]*)"\s*\])/g)) {
      const name = (m[1] ?? m[2]) as string;
      if (registered.has(name) || registered.has(name.replace(/_NEXT$/, ""))) {
        offenders.push(`${file}: ${name}`);
      }
    }
  }
  ok("the scan actually read the served source (non-vacuity)", served.length >= 10, `${served.length} files`);
  ok("no registered secret is read off process.env anywhere under artifacts/api-server/src — ONE door",
    offenders.length === 0, offenders.join("; "));
  ok("the registry is non-empty and every entry names a direction",
    REGISTRY.length > 0 && REGISTRY.every((s) => s.direction === "inbound" || s.direction === "outbound"));

  // ── 2. FAIL CLOSED ─────────────────────────────────────────────────────────
  const empty: NodeJS.ProcessEnv = {};
  ok("an UNCONFIGURED secret matches nothing", !matches(INBOUND, "anything", empty) && !matches(INBOUND, "", empty));
  ok("...and reads as unconfigured rather than as an empty value",
    readSecret(INBOUND, empty).value === undefined && readSecret(INBOUND, empty).presentButBlank === false);
  for (const blank of ["", "   ", "\t"]) {
    ok(`a secret SET to ${JSON.stringify(blank)} reads unconfigured AND present-but-blank`,
      readSecret(INBOUND, { [INBOUND]: blank }).value === undefined &&
      readSecret(INBOUND, { [INBOUND]: blank }).presentButBlank === true);
    ok(`...and matches nothing, including ${JSON.stringify(blank)} itself`,
      !matches(INBOUND, blank, { [INBOUND]: blank }) && !matches(INBOUND, "anything", { [INBOUND]: blank }));
  }
  const configured: NodeJS.ProcessEnv = { [INBOUND]: CURRENT };
  ok("a configured secret matches its own value", matches(INBOUND, CURRENT, configured));
  ok("...and refuses a near miss, an empty credential, and a prefix",
    !matches(INBOUND, `${CURRENT}x`, configured) && !matches(INBOUND, "", configured) &&
    !matches(INBOUND, CURRENT.slice(0, -1), configured));
  ok("a surrounding-whitespace value is trimmed, not treated as a different secret",
    matches(INBOUND, CURRENT, { [INBOUND]: `  ${CURRENT}  ` }));

  // ── 3. ROTATION, executed ──────────────────────────────────────────────────
  const rotating: NodeJS.ProcessEnv = { [INBOUND]: CURRENT, [successorName(INBOUND)]: SUCCESSOR };
  ok("mid-rotation BOTH the current value and the successor are accepted",
    matches(INBOUND, CURRENT, rotating) && matches(INBOUND, SUCCESSOR, rotating));
  ok("...and the reading says so, so an operator can see the window is open",
    readSecret(INBOUND, rotating).rotating === true && readSecret(INBOUND, configured).rotating === false);
  ok("a third value is still refused mid-rotation — the window widens to TWO, not to any",
    !matches(INBOUND, "a-third-value-nobody-published", rotating));
  const rotated: NodeJS.ProcessEnv = { [INBOUND]: SUCCESSOR };
  ok("once the successor is promoted and deleted, the OLD credential stops working (DR-010 rule 4)",
    !matches(INBOUND, CURRENT, rotated));
  ok("...and NOTHING ELSE does — the new credential keeps working", matches(INBOUND, SUCCESSOR, rotated));
  ok("a successor alone, with no current value, is still accepted (the mid-promotion instant is not an outage)",
    matches(INBOUND, SUCCESSOR, { [successorName(INBOUND)]: SUCCESSOR }));

  // ── 4. NOTHING LOGGABLE ────────────────────────────────────────────────────
  const status = secretStatus(INBOUND, rotating);
  const serialized = JSON.stringify(status);
  ok("the printable status carries no secret value", !serialized.includes(CURRENT) && !serialized.includes(SUCCESSOR));
  ok("...and carries a fingerprint for each, so two deployments can be compared without either being read",
    typeof status.fingerprint === "string" && typeof status.nextFingerprint === "string" &&
    status.fingerprint !== status.nextFingerprint && status.fingerprint!.length === 8);
  ok("a fingerprint is not the value and is not reversible by length",
    status.fingerprint !== CURRENT.slice(0, 8) && fingerprint(undefined) === null);
  ok("two different values fingerprint differently; the same value fingerprints identically",
    fingerprint("a") !== fingerprint("b") && fingerprint(CURRENT) === fingerprint(CURRENT));
  const inventory = JSON.stringify(secretInventory({ [INBOUND]: CURRENT, [OUTBOUND]: SUCCESSOR }));
  ok("the whole inventory, serialized, contains no secret value",
    !inventory.includes(CURRENT) && !inventory.includes(SUCCESSOR) && inventory.includes(INBOUND));

  // ── direction is enforced, and an undeclared secret is refused ─────────────
  ok("an OUTBOUND secret is read out, and reads the CURRENT value even mid-rotation",
    outboundSecret(OUTBOUND, { [OUTBOUND]: CURRENT, [successorName(OUTBOUND)]: SUCCESSOR }) === CURRENT);
  ok("an outbound secret cannot be compared, and an inbound one cannot be read out",
    refuses(() => secretMatches(OUTBOUND, CURRENT, { [OUTBOUND]: CURRENT })) &&
    refuses(() => outboundSecret(INBOUND, configured)));
  ok("an UNREGISTERED name is refused outright — a secret nobody declared is one no rotation plan covers",
    refuses(() => readSecret("SOME_UNDECLARED_TOKEN", { SOME_UNDECLARED_TOKEN: CURRENT })));

  console.log(`\nsecrets proof: ${checks - failed}/${checks} checks passed (${REGISTRY.length} registered secrets, ${served.length} served source files scanned)`);
  console.log(`summary=${failed === 0 ? "pass" : "fail"} (${checks - failed}/${checks})`);
  if (SELF_TEST) {
    if (failed > 0) {
      console.log("self-test: the planted fail-open (an unconfigured secret accepting anything) was CAUGHT — the proof can fail.");
      process.exit(0);
    }
    console.log("self-test: the planted fail-open was NOT caught — the proof cannot fail.");
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}

function refuses(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

main();
