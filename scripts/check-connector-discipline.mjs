// Connector-discipline gate — every integration family must be gated and proven,
// and none may act on a device.
//
// WHY THIS EXISTS. `uem/` sat outside connector discipline for a long time: no
// fixture mode, no tier gate, no `SIGNALGRID_LIVE_INTEGRATIONS` check, no proof —
// and it shipped `LockDevice`, remote-lock and passcode-bypass calls to real vendor
// APIs, plus a hardcoded `compliant: true` that reported every Jamf device healthy.
// None of that was caught by a gate. It was caught because somebody happened to look.
//
// "Somebody happened to look" is not a control. Worse, the audit that found it also
// found SIX MORE families in the same shape, one of them (`nac/`) with the same
// class of device actuator. A defect that recurs across a whole population is a
// missing gate, not a missing review.
//
// HOW THIS WORKS, following `check-guard-registries.mjs` — whose header states the
// principle this file is built on: "a guard whose coverage list is stale is WORSE
// than no guard, because it reports success over the part it has stopped looking at."
//
//   1. The family list is DERIVED from the filesystem, never hand-maintained. A new
//      connector directory is in scope the moment it exists.
//   2. Each family must have a live-call gate and a proof.
//   3. NO family may perform a device action (quarantine / lock / wipe / erase /
//      forced reauth) over the network. That is AGENTS.md:19 — "keep high-risk
//      actions simulated and approval-required."
//   4. Known gaps live in an explicit registry with a reason and a severity. They do
//      not fail the build — holding every PR hostage to pre-existing debt is how a
//      gate gets switched off — but they are PRINTED IN FULL on every run, so the
//      debt is stated rather than implied by silence.
//   5. THE REGISTRY CANNOT GO STALE, in both directions:
//        - a family that is neither disciplined nor registered FAILS, so new debt
//          cannot be added quietly;
//        - a family that IS registered but has since been fixed also FAILS, telling
//          you to delete the entry. An exemption list that outlives its subject is
//          the exact failure mode the precedent guard was written to prevent.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const familyDir = join(repo, "lib/integrations/src/integrations");
const proofDir = join(repo, "scripts/src");

const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

/** Directories that are not connector families. `adapters` holds shared type
 *  definitions; it has no vendor surface of its own. */
const NOT_A_FAMILY = new Set(["adapters"]);

/**
 * Pre-existing gaps, each with a reason a reader can evaluate.
 *
 * `severity` is the thing to read first:
 *   violation       — breaks a written rule in AGENTS.md. Fix, do not extend.
 *   ungated-emitter — sends outbound (tickets, events, logs) with no tier gate.
 *                     The POSTs are the family's PURPOSE, not a device action, so
 *                     this is a live-vendor-call boundary issue rather than a
 *                     platform-honesty one. Still needs a gate.
 *   unproven        — gated, but no proof asserts the gate actually holds.
 */
// `nac` was here, as the one entry with severity "violation": cisco-ise.ts and
// aruba-clearpass.ts called the ISE ANC / ClearPass APIs to quarantine an endpoint.
// Fixed — actuators removed, gated, proven — and the entry deleted, because rule 5
// made leaving it impossible. Staging the fix flipped the gate to FAILED with
// "KNOWN_GAPS lists nac as a gap, but it is now gated, proven and action-free",
// which is the registry refusing to describe the repo inaccurately in either
// direction. That is the whole point of the self-invalidation and it is worth
// recording that it worked on a real fix rather than only on a rehearsal.
const KNOWN_GAPS = {
  // gated-vs-fixture decision before a transport is added, so it stays listed.
  // `carrier` and `graph` were listed here on the assumption they had no proof. The
  // stale-entry check below immediately disproved it: they are covered by
  // carrier-reachability-proof.ts and graph-connector-proof.ts. Entries removed —
  // which is the self-invalidating half of this registry doing its job on its first run.
};


/**
 * Families that are disciplined but not yet CONSUMED, each with a reason.
 *
 * Deliberately separate from KNOWN_GAPS. These families ARE gated, proven and
 * action-free, so rule 2 would fire on a KNOWN_GAPS entry for them and demand its
 * deletion — correctly, because that registry tracks a different debt. Conflating the
 * two would make one of the two checks unusable.
 *
 * Self-invalidating in the same way: rule 2c below FAILS if a listed family has since
 * acquired a consumer, so an exemption cannot outlive its subject.
 */
const UNWIRED_OK = {
  "caep-events": {
    reason:
      "Outbound CAEP / Shared Signals emitter. It has no adapter because it is not a " +
      "decision dimension — it PUBLISHES session signals to a relying party rather than " +
      "contributing a verdict. Its consumer is a control-plane egress path that does not " +
      "exist yet; until it does, this is a latent trap rather than a live exposure, which " +
      "is the same posture the five ungated emitters were held in before they were gated.",
  },
  syslog: {
    reason:
      "Outbound syslog emitter, same shape as caep-events: it forwards, it does not " +
      "decide. Its four siblings (itsm, siem, telemetry, webhooks) each acquired a " +
      "consumer; this one has not, so it is real network code no code path reaches.",
  },
};

/** A device action performed over the network.
 *
 *  TWO ROUNDS OF FALSE POSITIVES shaped this, and both are worth recording because
 *  the naive version of this check is worse than useless:
 *
 *  1. Matching the VERB anywhere flagged `uem/`'s normalizers, which legitimately
 *     READ vendor enum values containing "wipe" (`retirePending`,
 *     `EnterpriseWipePending`). Banning the vocabulary would force them to obfuscate
 *     the very states they exist to recognise.
 *  2. Requiring verb + a mutating request in the same FILE then flagged `itsm/`,
 *     whose ticket templates carry `device_quarantine: { category: 'Software' }`
 *     alongside the POST that creates a ticket. Describing a quarantine in a ticket
 *     is the opposite of performing one.
 *
 *  So the verb must be INVOKED or DECLARED — immediately followed by `(`. That
 *  matches `async quarantineEndpoint(` in cisco-ise.ts and misses a data literal.
 *  Narrow on purpose: a check that cries wolf gets switched off, and this one has to
 *  survive long enough to catch the next `uem/`. */
const ACTION_CALL =
  /\b(quarantineEndpoint|unquarantineEndpoint|quarantine|unquarantine|lockDevice|remoteLock|bypassActivationLock|eraseDevice|wipeDevice|reauthenticate|disconnectEndpoint)\s*\(/i;
const MUTATING_REQUEST = /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i;

/**
 * Comments are stripped before ANY rule below looks at a file.
 *
 * A comment cannot satisfy a gate, and it cannot commit a device action either.
 * The previous version dropped whole lines that LOOKED like comments (`//`, `*`,
 * `/*` at the start), which is not the same thing: a trailing `// see
 * SIGNALGRID_LIVE_INTEGRATIONS` on a code line, or the interior of a block
 * comment whose lines are not star-prefixed, both survived and would have read as
 * a gate. That is a fail-open — the gate would have reported a family disciplined
 * on the strength of prose ABOUT the discipline. This is a character scanner:
 * line comments and block comments go, string literals STAY (the real check is
 * spelled `env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true"`, so the literal is
 * load-bearing), and newlines are preserved so reported line numbers are exact.
 *
 * A `'`/`"` string is also terminated by a newline, so an unbalanced quote inside
 * something this scanner does not model (a regex literal, say) can corrupt at most
 * one line rather than swallowing the rest of the file.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
        if (quote !== "`" && source[i] === "\n") break;
        out += source[i];
        i += 1;
        if (source[i - 1] === quote) break;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const LIVE_GATE = /SIGNALGRID_LIVE_INTEGRATIONS/;

/**
 * The identifier of the shared emitter-gate factory. THIS IS THE ONLY THING
 * HARDCODED — the file it lives in is derived by following the family's own
 * import, so moving or renaming the module cannot silently orphan this check.
 *
 * WHY THIS EXISTS. Ponytail cut 4 (ff27e75) folded six byte-identical emitter
 * gates — itsm, siem, syslog, telemetry, webhooks, caep-events — into
 * `createEmitterResolver()`. The discipline did not change: the same
 * tier / SIGNALGRID_LIVE_INTEGRATIONS / token / injected-transport chain runs, once
 * instead of six times. But this gate tested the family's OWN file bodies, so five
 * families reported "no SIGNALGRID_LIVE_INTEGRATIONS gate" the moment the duplication
 * they were being credited for went away. A gate that punishes a correct refactor is
 * measuring the copy, not the control.
 *
 * (webhooks kept passing, and for a reason worth naming: `webhooks/dispatch.ts`
 * still performs its own inline `env.SIGNALGRID_LIVE_INTEGRATIONS !== 'true'` check
 * in real code. It was never passing on the comment in its resolve.ts — but nothing
 * stopped it from doing so until the stripper above, which is why both halves of
 * this fix had to land together.)
 */
const RESOLVER_FACTORY = "createEmitterResolver";

/** Follow `import { createEmitterResolver, … } from "<specifier>"` out of a family
 *  file to the module that defines it. Returns the tracked repo-relative path and
 *  its source, or null if the import cannot be resolved to a file in this tree —
 *  unresolvable is NOT gated. */
function resolveFactoryModule(fromRel, source) {
  const importOfFactory = new RegExp(
    `import\\s*(?:type\\s*)?\\{[^}]*\\b${RESOLVER_FACTORY}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`,
  );
  const m = importOfFactory.exec(source);
  if (!m) return null;
  const spec = m[1];
  if (!spec.startsWith(".")) return null; // a package specifier is not a file in this tree
  const base = resolve(dirname(join(repo, fromRel)), spec);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    const rel = relative(repo, candidate);
    if (!tracked.has(rel)) continue;
    return { rel, source: readFileSync(candidate, "utf8") };
  }
  return null;
}

/**
 * Does this family carry the live-call gate, and in which of the two legitimate
 * forms? Pure: the caller supplies the family's files and a module reader, so the
 * self-test drives THIS function rather than a paraphrase of it.
 *
 *   own                → the check is in the family's own code (comments stripped)
 *   via <path>         → the family calls the shared factory, and the FACTORY's own
 *                        code (comments stripped) carries the check
 *   null               → not gated
 *
 * The factory form is checked, never assumed: calling something named
 * `createEmitterResolver` proves nothing if the thing it resolves to has lost the
 * check. That is self-test case (b).
 */
function gateFormOf(files, readModule) {
  for (const f of files) {
    if (LIVE_GATE.test(stripComments(f.source))) return "own";
  }
  for (const f of files) {
    const code = stripComments(f.source);
    if (!new RegExp(`\\b${RESOLVER_FACTORY}\\s*[<(]`).test(code)) continue;
    const mod = readModule(f.rel, f.source);
    if (!mod) continue;
    if (LIVE_GATE.test(stripComments(mod.source))) return `via ${mod.rel}`;
  }
  return null;
}

const tracked = new Set(
  execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean),
);

function analyzeFamily(name) {
  const dir = join(familyDir, name);
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ rel: `lib/integrations/src/integrations/${name}/${f}`, file: f }))
    .filter((f) => tracked.has(f.rel))
    .map((f) => ({ ...f, source: readFileSync(join(dir, f.file), "utf8") }));

  // The live-call gate, in either legitimate form — the family's own code, or the
  // shared factory it imports. Comments are stripped in BOTH, so prose about the
  // gate can never stand in for the gate.
  const gateForm = gateFormOf(sources, resolveFactoryModule);
  const gated = gateForm !== null;

  let performsAction = false;
  const actionSites = [];
  for (const f of sources) {
    const code = stripComments(f.source);
    if (ACTION_CALL.test(code) && MUTATING_REQUEST.test(code)) {
      performsAction = true;
      // Line numbers are exact: the stripper preserves newlines.
      code.split("\n").forEach((l, i) => { if (ACTION_CALL.test(l)) actionSites.push(`${f.file}:${i + 1}`); });
    }
  }

  // A proof either lives at the conventional path, or the family is covered by a
  // proof that imports it by subpath. Both count — what must not count is "nothing".
  const conventional = existsSync(join(proofDir, `${name}-proof.ts`));
  const importedByAProof = readdirSync(proofDir)
    .filter((f) => f.endsWith("-proof.ts"))
    .some((f) => new RegExp(`@workspace/integrations/${name}\\b`).test(readFileSync(join(proofDir, f), "utf8")));

  return { name, gated, gateForm, proven: conventional || importedByAProof, performsAction, actionSites,
           consumers: consumersOf(name) };
}

/**
 * Who imports this family from OUTSIDE its own directory.
 *
 * DERIVED, NOT ASSERTED, and it is the single most decision-relevant fact about the
 * ungated emitters. An audit found all five of them — itsm, siem, syslog, telemetry,
 * webhooks — with ZERO external consumers: real network code that no code path reaches,
 * which is a latent trap rather than a live exposure, exactly like the connector config
 * stores that were tenant-scoped earlier.
 *
 * That distinction sets the urgency of the owner's gated-vs-fixture decision, so it must
 * not be a sentence in a document that silently goes stale. Recomputed every run, and
 * printed beside each known gap: the day someone wires one up, the number moves and the
 * decision stops being theoretical. Counting rather than failing, because wiring one up
 * is a legitimate thing to do once the decision is made — the gate's job here is to make
 * it impossible to do QUIETLY.
 */
function consumersOf(name) {
  const needle = new RegExp(`from ['"][^'"]*integrations/${name}(?:/|['"])|@workspace/integrations/${name}\\b`);
  const hits = [];
  for (const rel of tracked) {
    if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) continue;
    if (rel.startsWith(`lib/integrations/src/integrations/${name}/`)) continue;
    if (rel.includes("/dist/")) continue;
    let text;
    try { text = readFileSync(join(repo, rel), "utf8"); } catch { continue; }
    if (needle.test(text)) hits.push(rel);
  }
  return hits;
}

/**
 * SELF-TEST — a gate nobody has watched fail is a gate nobody should trust.
 *
 * Runs on EVERY invocation (a wrong answer here fails the gate) and printable in
 * full with `--self-test`. It drives the real `gateFormOf` / `stripComments`, not a
 * paraphrase, against four synthetic families:
 *
 *   a  calls the factory, factory carries the check      → gated via the factory
 *   b  calls the factory, factory's check REMOVED        → NOT gated  (the fold is
 *                                                          verified, not trusted)
 *   c  the string appears only in a COMMENT              → NOT gated  (prose about a
 *                                                          gate is not a gate)
 *   d  the check is in the family's own code             → gated: own
 *
 * (b) and (c) are the two ways this gate could fail open, and they are the two
 * cases the version before this fix would have got wrong.
 */
const FACTORY_WITH_CHECK = `
export function ${RESOLVER_FACTORY}(config) {
  return (env = process.env) => {
    if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") return { mode: "fixture" };
    return { mode: "live" };
  };
}
`;
const FACTORY_WITHOUT_CHECK = `
export function ${RESOLVER_FACTORY}(config) {
  return (env = process.env) => ({ mode: "live" });
}
`;
const FAMILY_CALLING_FACTORY = `
// Live-call gate: dev/alpha never emit; beta/prod need SIGNALGRID_LIVE_INTEGRATIONS=true.
import { ${RESOLVER_FACTORY} } from "../adapters/emitter-resolver";
export const resolveFakeEmitter = ${RESOLVER_FACTORY}({ tokenEnvVar: "FAKE_TOKEN" });
`;

function selfTestCases() {
  const factoryReader = (source) => (_fromRel, _familySource) =>
    source === null ? null : { rel: "lib/integrations/src/integrations/adapters/emitter-resolver.ts", source };
  const family = (source) => [{ rel: "lib/integrations/src/integrations/fake/resolve.ts", source }];

  const a = gateFormOf(family(FAMILY_CALLING_FACTORY), factoryReader(FACTORY_WITH_CHECK));
  const b = gateFormOf(family(FAMILY_CALLING_FACTORY), factoryReader(FACTORY_WITHOUT_CHECK));
  const c = gateFormOf(
    family(`// beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true and a credential.\n` +
           `/* block comment mentioning SIGNALGRID_LIVE_INTEGRATIONS */\n` +
           `export const x = 1; // trailing SIGNALGRID_LIVE_INTEGRATIONS mention\n`),
    () => null,
  );
  const d = gateFormOf(
    family(`export const live = (env) => env["SIGNALGRID_LIVE_INTEGRATIONS"] === "true";\n`),
    () => null,
  );
  return [
    { id: "a", want: "via lib/integrations/src/integrations/adapters/emitter-resolver.ts", got: a,
      what: "family calls the factory and the factory carries the check → gated via factory" },
    { id: "b", want: null, got: b,
      what: "same family, factory's check removed → NOT gated (a factory call is not evidence)" },
    { id: "c", want: null, got: c,
      what: "the string only in line/block/trailing COMMENTS → NOT gated" },
    { id: "d", want: "own", got: d,
      what: "the check in the family's own code → gated: own" },
  ];
}

const selfTest = selfTestCases();
const selfTestOk = selfTest.every((t) => t.got === t.want);

if (process.argv.includes("--self-test")) {
  for (const t of selfTest) {
    console.log(`  ${t.got === t.want ? "PASS" : "FAIL"}  (${t.id}) ${t.what}` +
      (t.got === t.want ? "" : `  — wanted ${JSON.stringify(t.want)}, got ${JSON.stringify(t.got)}`));
  }
  console.log(selfTestOk
    ? "\nPASS  self-test — the live-gate check follows a resolver fold and refuses a comment."
    : "\nFAIL  self-test — the live-gate check has drifted; its verdicts cannot be trusted.");
  process.exit(selfTestOk ? 0 : 1);
}

console.log("Connector-discipline gate — every family gated and proven, none acting on a device\n");

const families = readdirSync(familyDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NOT_A_FAMILY.has(e.name))
  .map((e) => e.name)
  .sort();

console.log(`families derived from the filesystem: ${families.length}\n`);

// ── 0. The files this gate used to walk straight past ────────────────────────
//
// The enumeration above takes DIRECTORIES only, which was right for what it was
// written to cover and became a blind spot the moment anything outbound landed in the
// integrations root as a loose file. It reported "48 of 48 families are gated, proven
// and action-free" — accurate, and not the same claim as "nothing here makes an
// ungated vendor call".
//
// What was hiding there: `dispatcher.ts`, an unsigned-tier, ungated
// `fetch(t.url, { method: "POST" })` that shipped the whole IntegrationEvent to an
// arbitrary list of URLs, with `const TARGETS = []` and a TODO inviting someone to
// populate it. Dead, unexported, zero callers — and a trap, because the supported path
// (the gated, signed, proven `webhooks/` family) already existed alongside it. Deleted
// rather than gated: a second implementation of a disciplined family is debt whether
// or not it has a gate bolted on.
//
// A gate that enumerates one shape of thing will keep passing while the next problem
// arrives in a different shape. This scans the loose files too.
const looseFiles = readdirSync(familyDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".ts"))
  .map((e) => e.name)
  .sort();

let looseProblems = 0;
for (const name of looseFiles) {
  const path = join(familyDir, name);
  const code = stripComments(readFileSync(path, "utf8"));
  const outbound = MUTATING_REQUEST.test(code) && /\bfetch\s*\(/.test(code);
  const gated = LIVE_GATE.test(code);
  if (outbound && !gated) {
    looseProblems += 1;
    bad(
      `integrations/${name}: makes an ungated outbound call (mutating fetch, no ` +
        `SIGNALGRID_LIVE_INTEGRATIONS gate) from a loose file rather than a family. ` +
        `Move it into a gated family, or delete it if a gated family already does this.`,
    );
  }
  if (ACTION_CALL.test(code)) {
    looseProblems += 1;
    bad(`integrations/${name}: performs a device action over the network from a loose file.`);
  }
}
// Only claim the clean result when it is true. A ✓ printed beside its own ✗ is the
// kind of output a reader learns to skim past.
if (looseProblems === 0) {
  ok(`${looseFiles.length} loose files in the integrations root carry no ungated egress and no device action`);
}

const results = families.map(analyzeFamily);
const disciplined = results.filter((r) => r.gated && r.proven && !r.performsAction);

// ── 1. Undisciplined and unregistered → FAIL (new debt cannot be added quietly) ──
for (const r of results) {
  const problems = [];
  if (!r.gated) problems.push("no SIGNALGRID_LIVE_INTEGRATIONS gate");
  if (!r.proven) problems.push("no proof");
  if (r.performsAction) problems.push(`performs a device action over the network (${r.actionSites.slice(0, 3).join(", ")})`);
  if (problems.length === 0) continue;
  if (!KNOWN_GAPS[r.name]) {
    bad(
      `${r.name}: ${problems.join("; ")}. Bring it under connector discipline, or — if that is genuinely ` +
        `not possible yet — add it to KNOWN_GAPS in this file with a reason. Silence is not an option.`,
    );
  }
}

// ── 2. Registered but since fixed → FAIL (the registry must not outlive its subject) ──
for (const name of Object.keys(KNOWN_GAPS)) {
  const r = results.find((x) => x.name === name);
  if (!r) {
    bad(`KNOWN_GAPS lists "${name}", which is no longer a connector family. Remove the entry.`);
    continue;
  }
  if (r.gated && r.proven && !r.performsAction) {
    bad(
      `KNOWN_GAPS lists "${name}" as a gap, but it is now gated, proven and action-free. ` +
        `Delete the entry — a stale exemption reports success over something nobody is checking any more.`,
    );
  }
}

// ── 2c. Listed as unwired but since consumed → FAIL (no exemption outlives its subject) ──
for (const name of Object.keys(UNWIRED_OK)) {
  const r = results.find((x) => x.name === name);
  if (!r) {
    bad(`UNWIRED_OK lists "${name}", which is no longer a connector family. Remove the entry.`);
    continue;
  }
  if (r.consumers.some((c) => !/-proof\.ts$/.test(c))) {
    bad(
      `UNWIRED_OK lists "${name}" as consumed by nothing, but something now imports it. ` +
        `Delete the entry — a stale exemption reports success over something nobody is checking any more.`,
    );
  }
}

// ── 3. Announce the debt in full, every run ─────────────────────────────────────
const gaps = results
  .filter((r) => KNOWN_GAPS[r.name])
  .map((r) => ({ ...r, ...KNOWN_GAPS[r.name] }))
  .sort((a, b) => (a.severity === "violation" ? -1 : b.severity === "violation" ? 1 : 0));


// ── 2b. Gated and proven, and consumed by NOTHING → FAIL ────────────────────────
//
// WHY THIS EXISTS, and it is a defect this gate previously reported success over.
//
// `consumersOf` has been computed since the ungated-emitter audit, but only ever
// COUNTED — printed beside a known gap so a wiring change could not happen quietly.
// The inverse case was never checked, and three families reached the branch in that
// state: `credential-rotation`, `observability-integrity` and `local-authority` were
// each gated, proven, mutation-swept, registered in preflight and CI, and imported by
// nothing but their own proof. This gate printed "51 of 51 families are gated, proven
// and action-free" over them, which was true and was not the claim a reader takes from
// it. "51 connector families" reads as 51 dimensions feeding decisions.
//
// A proven island is the unearned affirmative in its purest form: every gate green,
// and the thing the green implies — that the dimension participates — established by
// nobody. It was found by a human looking, which AGENTS.md and this file's own header
// both say is not a control.
//
// FAILING rather than counting, deliberately. At the time this was added every family
// had a consumer, so there is no pre-existing debt to hold a PR hostage to — the rule
// only ever blocks a NEW island. A family that genuinely should stand alone for a
// while can say so in KNOWN_GAPS, where rule 5 will delete the entry the moment it is
// wired up.
for (const r of results) {
  // A PROOF IS NOT A CONSUMER. `consumersOf` deliberately counts every tracked file
  // outside the family's own directory, which includes `scripts/src/<name>-proof.ts` —
  // so an island always has exactly one 'consumer' and a naive check here can never
  // fire. The first draft of this check was written that way and a negative control
  // caught it: the gate still passed with the adapter import deleted. Exercising a new
  // guard against the failure it claims to catch is the only thing that distinguishes
  // it from decoration.
  const participating = r.consumers.filter((c) => !/-proof\.ts$/.test(c));
  if (participating.length > 0) continue;
  if (KNOWN_GAPS[r.name] || UNWIRED_OK[r.name]) continue;
  bad(
    `${r.name}: gated and proven, and NOTHING imports it outside its own directory and proof. ` +
      `A dimension nothing consumes does not participate in any decision, however green its own ` +
      `gates are. Wire it into a consumer (for a decision dimension that usually means a ` +
      `\`from${r.name.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())}\` adapter in ` +
      `@workspace/posture-composition, plus a SIGNAL_KINDS entry and incident routing), or add ` +
      `it to UNWIRED_OK in this file with a reason.`,
  );
}

if (selfTestOk) {
  ok(`self-test: the live-gate check follows a resolver fold (a) and refuses a stripped factory (b), a comment (c); own-code check still counts (d)`);
} else {
  bad(
    `SELF-TEST FAILED — ${selfTest.filter((t) => t.got !== t.want).map((t) => t.id).join(", ")}. ` +
      `The live-gate detection has drifted, so every "gated" verdict below is unreliable. ` +
      `Run \`node scripts/check-connector-discipline.mjs --self-test\` for the detail.`,
  );
}

// WHICH FORM satisfied the gate, per family — so a fold is VISIBLE, not silent.
// When six families' gates were folded into one factory this gate said nothing and
// then said "no gate"; the point of printing the form is that the next fold shows up
// as a changed line here instead of as a failure nobody expected.
console.log("\n  live-call gate, per family (own code, or the shared factory it imports):");
for (const r of results) {
  console.log(`    ${r.name.padEnd(26)} ${r.gateForm ? `gated: ${r.gateForm}` : "NOT GATED"}`);
}
const viaFactory = results.filter((r) => r.gateForm && r.gateForm !== "own");
console.log(
  `    → ${results.filter((r) => r.gateForm === "own").length} gated in their own code, ` +
    `${viaFactory.length} via a shared factory, ${results.filter((r) => !r.gateForm).length} not gated.\n`,
);

ok(`${disciplined.length} of ${families.length} families are gated, proven and action-free`);

if (gaps.length) {
  console.log(`\n  KNOWN GAPS — ${gaps.length} families, stated rather than implied by silence:`);
  for (const g of gaps) {
    const missing = [
      !g.gated ? "ungated" : null,
      !g.proven ? "unproven" : null,
      g.performsAction ? "DEVICE ACTION" : null,
    ].filter(Boolean).join(" + ");
    console.log(`    [${g.severity}] ${g.name} (${missing})`);
    console.log(`        ${g.reason}`);
    // THE URGENCY LINE, and it is deliberately factual rather than a verdict.
    //
    // A hand-rolled grep run during the audit reported "zero external references" for
    // all five. That was WRONG — its exclusion pattern also excluded the package barrel,
    // which re-exports four of them. This derived version caught the error on its first
    // run, which is the argument for deriving rather than asserting, made against the
    // person writing the guard.
    //
    // IMPORTED IS NOT INVOKED. A barrel re-export puts the family on the public surface
    // of `@workspace/integrations` without any code calling its send/dispatch path. The
    // importer is NAMED rather than graded so a reader can tell those apart instead of
    // trusting an adjective chosen here.
    console.log(
      g.consumers.length === 0
        ? `        reach: no file outside its own directory imports it`
        : `        reach: imported by ${g.consumers.length} file(s) outside the family — ${g.consumers.join(", ")}`,
    );
  }
  const violations = gaps.filter((g) => g.severity === "violation");
  if (violations.length) {
    console.log(
      `\n  ${violations.length} of these break a written rule in AGENTS.md and should be fixed, not extended: ` +
        `${violations.map((v) => v.name).join(", ")}.`,
    );
  }
}

console.log(
  "\n  This gate blocks NEW undisciplined families and NEW device actuators. It does not\n" +
    "  fail on the gaps above — holding every PR hostage to pre-existing debt is how a gate\n" +
    "  gets switched off — but it will fail the moment one of them is fixed and its entry\n" +
    "  is left behind.",
);

if (failures.length) {
  console.error(`\nConnector-discipline gate FAILED: ${failures.length} problem${failures.length === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("\nConnector-discipline gate passed.");
