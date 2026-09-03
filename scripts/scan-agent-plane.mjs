// Out-of-repo agent-plane scan — the executable layer no gate can see.
//
// WHY THIS EXISTS. `scripts/check-org-roster.mjs` derives the set of
// dispatchable executors from disk, and that derivation reads exactly two
// directories: `.claude/agents` and `.claude/skills`, both under the repository
// root. That is correct and deliberate — a roster may only name an executor
// that is committed, reviewable, and reachable by CI.
//
// It is also not the whole plane. Claude loads skills from the USER's home
// directory too (`~/.claude/skills/`), and on 2026-08-25 an audit found
// `signalgrid-master` sitting there: a 378-line skill that names itself
// "SignalGrid's first-party orchestration layer", declares an authority order
// for this exact repository, and cites 18 repository-relative paths. It was
// generated from `SignalGrid_Alpha@08eecbe`, it is accurate today, and it is
// invisible to every gate in this tree. Nothing committed here can detect it
// changing, going stale, or contradicting `CLAUDE.md` — because it never
// appears in a diff.
//
// So this reports the plane the roster gate cannot reach. It is REPORTED, never
// fatal, and NOT registered in CI — a CI runner has no `~/.claude`, so a gate
// asserting on it would either pass vacuously or fail every run. That is the
// same reason `scan:estate` is a local scan: a check whose subject is absent
// from CI must not pretend CI can hold it.
//
// FAIL-CLOSED. A directory that cannot be read is reported NOT SCANNED and is
// never counted clean. An empty result is only "nothing out there" when the
// root existed and was readable; otherwise it is "unknown", which is a
// different sentence.
//
//   node scripts/scan-agent-plane.mjs
//   node scripts/scan-agent-plane.mjs --self-test   # prove it can report

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Repo-relative paths a skill cites. Anchored to this repo's top-level dirs. */
const CITED = /(?:^|[\s`("'])((?:docs|scripts|lib|artifacts|native|fleet|\.claude|\.github)\/[A-Za-z0-9_.*/-]+)/g;

/** A trailing `.` or `,` is prose punctuation, not part of the path. */
const trimCite = (p) => p.replace(/[.,;:)]+$/, "");

/**
 * Walk a skills root and return one record per SKILL.md found. Pure over an
 * injected reader so the self-test can plant a fixture without touching disk.
 */
export function scanSkillRoot(root, io) {
  if (!io.exists(root)) return { root, scanned: false, reason: "no such directory", skills: [] };
  let entries;
  try {
    entries = io.list(root);
  } catch (err) {
    return { root, scanned: false, reason: `unreadable: ${err.message}`, skills: [] };
  }
  const skills = [];
  for (const name of entries) {
    const md = join(root, name, "SKILL.md");
    if (!io.exists(md)) continue;
    let body;
    try {
      body = io.read(md);
    } catch (err) {
      skills.push({ name, path: md, readable: false, reason: err.message, cites: [], missing: [] });
      continue;
    }
    const raw = [...new Set([...body.matchAll(CITED)].map((m) => trimCite(m[1])))].sort();
    // A path that resolves inside the SKILL'S OWN directory is the skill's own
    // bundled asset, not a claim about this repository. `docx` ships
    // `scripts/recalc.py` beside its SKILL.md; reading that as a dead repo path
    // produced twelve false positives on the first live run, and a reporter
    // that is wrong twelve times out of sixteen is one nobody reads again.
    const own = join(root, name);
    const cites = raw.filter((c) => !io.exists(join(own, c)));
    const local = raw.length - cites.length;
    // A glob cannot be existence-checked by path; report it, never judge it.
    const concrete = cites.filter((c) => !c.includes("*"));
    const absent = concrete.filter((c) => !io.exists(join(repo, c)));
    // An extensionless token that matches nothing is ambiguous between a dead
    // path and ordinary prose — `signalgrid-master` says "docs/claims match
    // truth", which is a sentence. Report the ambiguity rather than resolving
    // it silently in either direction.
    const missing = absent.filter((c) => /\.[a-z0-9]+$/i.test(c));
    const unresolved = absent.filter((c) => !/\.[a-z0-9]+$/i.test(c));
    skills.push({
      name, path: md, readable: true, cites, local, missing, unresolved,
      namesRepo: /SignalGrid-Review-Hub/.test(body),
      // `wc -l` semantics: a trailing newline terminates the last line rather than
      // starting an empty one. split("\n").length reported 379 for a 378-line file.
      lines: body.replace(/\n$/, "").split("\n").length,
    });
  }
  return { root, scanned: true, skills };
}

/** A skill is THIS REPO'S business when it cites repo paths, whatever its name. */
export const claimsThisRepo = (s) => s.readable && s.cites.length > 0;

const io = {
  exists: (p) => existsSync(p),
  list: (p) => readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()),
  read: (p) => readFileSync(p, "utf8"),
};

function selfTest() {
  const checks = [];
  // Fixture disk. Building the negatives by subtraction from ONE complete
  // fixture keeps them negative as the record shape grows.
  const files = new Map([
    ["/fake/good/SKILL.md", "see `docs/CI_AND_VALIDATION.md` and `scripts/preflight.mjs`"],
    ["/fake/stale/SKILL.md", "see `docs/GONE_FOREVER.md`"],
    ["/fake/mute/SKILL.md", "a skill about nothing in particular"],
    ["/fake/globby/SKILL.md", "covers `lib/signalgrid-core/**`"],
    ["/fake/bundled/SKILL.md", "run `scripts/recalc.py` and `scripts/preflight.mjs`"],
    ["/fake/prosey/SKILL.md", "make sure `docs/claims` match truth"],
    ["/fake/named/SKILL.md", "compatibility: SignalGrid-Review-Hub. See `docs/CI_AND_VALIDATION.md`"],
  ]);
  const names = ["good", "stale", "mute", "globby", "bundled", "prosey", "named"];
  const dirs = new Set(["/fake", ...names.map((n) => `/fake/${n}`)]);
  // The bundled skill ships its own `scripts/recalc.py`; `scripts/preflight.mjs`
  // it does NOT ship, so exactly one of its two citations is skill-local.
  const bundledAssets = new Set(["/fake/bundled/scripts/recalc.py"]);
  const fio = {
    exists: (p) => dirs.has(p) || files.has(p) || bundledAssets.has(p) || (p.startsWith(repo) && existsSync(p)),
    list: () => names,
    read: (p) => files.get(p),
  };

  let r = scanSkillRoot("/fake", fio);
  checks.push(["a readable root is SCANNED", r.scanned === true]);
  // Derived from the fixture, not pinned: a hand-written total silently stops
  // asserting the moment a fixture is added.
  checks.push(["every SKILL.md under it is found", r.skills.length === names.length]);

  const good = r.skills.find((s) => s.name === "good");
  checks.push(["a skill citing real repo paths is reported with ZERO missing", good.missing.length === 0 && good.cites.length === 2]);

  const stale = r.skills.find((s) => s.name === "stale");
  checks.push(["a skill citing a path that does not exist reports it MISSING", stale.missing.includes("docs/GONE_FOREVER.md")]);

  const mute = r.skills.find((s) => s.name === "mute");
  checks.push(["a skill citing no repo path does not claim this repo", claimsThisRepo(mute) === false]);
  checks.push(["...and a skill citing one DOES", claimsThisRepo(good) === true]);

  const globby = r.skills.find((s) => s.name === "globby");
  checks.push(["a glob is reported as a citation but never existence-judged", globby.cites.length === 1 && globby.missing.length === 0]);

  // Skill-local suppression, with its positive control: the SAME record must
  // drop the bundled asset AND keep the repo path, or the filter is just
  // deleting everything.
  const bundled = r.skills.find((s) => s.name === "bundled");
  checks.push(["a path the skill BUNDLES itself is not a repo citation", bundled.local === 1 && !bundled.cites.includes("scripts/recalc.py")]);
  checks.push(["...and a path it does NOT bundle survives the same filter", bundled.cites.includes("scripts/preflight.mjs") && bundled.missing.length === 0]);

  // The prose bucket, and its positive control one line down: extensionless
  // goes to `unresolved`, extensioned still goes to `missing`.
  const prosey = r.skills.find((s) => s.name === "prosey");
  checks.push(["an extensionless dead token is UNRESOLVED, not asserted missing", prosey.unresolved.includes("docs/claims") && prosey.missing.length === 0]);
  checks.push(["...while an extensioned dead path is still MISSING", stale.missing.includes("docs/GONE_FOREVER.md") && stale.unresolved.length === 0]);

  const named = r.skills.find((s) => s.name === "named");
  checks.push(["a skill NAMING this repository is flagged as such", named.namesRepo === true]);
  checks.push(["...and one that only cites paths is not", good.namesRepo === false]);

  // Fail-closed halves. An absent or unreadable root is NOT a clean scan.
  r = scanSkillRoot("/nope", fio);
  checks.push(["an ABSENT root is NOT SCANNED, not clean", r.scanned === false && r.skills.length === 0]);

  r = scanSkillRoot("/fake", { ...fio, list: () => { throw new Error("EACCES"); } });
  checks.push(["an UNREADABLE root is NOT SCANNED, not clean", r.scanned === false && /EACCES/.test(r.reason)]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

/**
 * Skills that exist BOTH here and in the user's synced set, per DR-018. The
 * repository copy is authoritative; the synced one is a mirror.
 *
 * `.claude/skills/VENDORED.md` claimed this scanner "will say so when the two
 * disagree" from the day the mirror landed. It did not — the scanner read three
 * roots under the home directory and never opened the in-repo copy, so the
 * safeguard named in the document did not exist. Found by the first
 * agent-platform-engineer shift, 2026-08-25, on the same day the sentence was
 * written. The two were byte-identical at the time, so nothing had drifted; the
 * control was simply absent, which is the harder half to notice.
 */
const MIRRORED = [
  { id: "signalgrid-master", inRepo: ".claude/skills/signalgrid-master/SKILL.md", synced: join(homedir(), ".claude/skills/synced/signalgrid-master/SKILL.md") },
];

function reportMirrorDrift() {
  console.log("\nMirrored skills — the repository copy is authoritative (DR-018):");
  for (const m of MIRRORED) {
    const here = existsSync(join(repo, m.inRepo)) ? readFileSync(join(repo, m.inRepo), "utf8") : null;
    const there = existsSync(m.synced) ? readFileSync(m.synced, "utf8") : null;
    if (here === null) {
      console.log(`  NOT IN REPO   ${m.id} — the authoritative copy is missing; the mirror cannot be checked against it`);
      continue;
    }
    if (there === null) {
      console.log(`  no mirror     ${m.id} — nothing synced on this machine to compare against`);
      continue;
    }
    if (here === there) {
      console.log(`  identical     ${m.id} (${here.replace(/\n$/, "").split("\n").length} lines)`);
    } else {
      console.log(`  DIVERGED      ${m.id} — the synced copy differs from the committed one.`);
      console.log("                The committed copy wins. Correct the synced copy, not this file.");
    }
  }
}

// walker-floor: not needed — this is a REPORTED-only tool (never fatal, never in
// CI), and it does not fail on scanning nothing. Each root is reported SCANNED or
// NOT SCANNED individually (see the per-root `scanned` field), so an empty or
// absent root is surfaced by name rather than hidden behind a green count.
const ROOTS = [
  join(homedir(), ".claude", "skills"),
  join(homedir(), ".claude", "skills", "synced"),
  join(homedir(), ".claude", "plugins"),
];

console.log("Out-of-repo agent plane — REPORTED, never fatal, never run in CI.\n");
let claiming = 0;
let unscanned = 0;
let stale = 0;

for (const root of ROOTS) {
  const r = scanSkillRoot(root, io);
  if (!r.scanned) {
    unscanned += 1;
    console.log(`NOT SCANNED  ${root} — ${r.reason}`);
    continue;
  }
  const relevant = r.skills.filter(claimsThisRepo).sort((a, b) => Number(b.namesRepo) - Number(a.namesRepo));
  console.log(`SCANNED      ${root} — ${r.skills.length} skill(s), ${relevant.length} citing this repository`);
  for (const s of relevant) {
    claiming += 1;
    const tier = s.namesRepo ? "NAMES THIS REPOSITORY" : "cites repo-shaped paths";
    const verdict = s.missing.length === 0 ? "every cited path exists" : `${s.missing.length} CITED PATH(S) MISSING`;
    console.log(`  · ${s.name} — ${tier}`);
    console.log(`      ${s.lines} lines, ${s.cites.length} repo citation(s)${s.local ? `, ${s.local} skill-local asset(s) ignored` : ""} — ${verdict}`);
    for (const m of s.missing) {
      stale += 1;
      console.log(`      MISSING:    ${m}`);
    }
    for (const u of s.unresolved) console.log(`      unresolved: ${u} (extensionless — may be prose)`);
  }
}

reportMirrorDrift();

console.log(`\n${claiming} out-of-repo skill(s) speak for this repository. ${stale} stale citation(s). ${unscanned} root(s) NOT SCANNED.`);
if (claiming > 0) {
  console.log("These are NOT under version control here: they can change with no diff,");
  console.log("no review, and no gate. `check-org-roster.mjs` cannot name them as executors.");
}
