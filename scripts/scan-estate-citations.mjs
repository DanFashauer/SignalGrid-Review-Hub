// scan-estate-citations.mjs — run the cited-path check across every repository in the
// estate, not just this one.
//
//   node scripts/scan-estate-citations.mjs              # report
//   node scripts/scan-estate-citations.mjs --json       # machine-readable
//   node scripts/scan-estate-citations.mjs --self-test  # the locator and the tally; no disk, no git
//
// WHY THE ESTATE AND NOT JUST THIS REPO. The defect this catches — a document citing a
// file that is not there — is worst in the repositories nobody is looking at. This one
// has 189 gates watching it (measured 2026-09-06 by `node scripts/check-gate-census.mjs`,
// which prints the current figure — this line said "~175" and there is no point retyping a
// number the census owns); the private core, the legacy `DEV` tree and the MCP server
// have none. And a reader deciding what to build does not stop at a repository boundary:
// the private core's own "Where things live" map is exactly the kind of document an
// agent treats as ground truth, and it is the least likely to have been re-measured.
//
// A REPO THAT COULD NOT BE SCANNED IS REPORTED, NEVER COUNTED CLEAN. This is the same
// law the simulation-request loop enforces one floor down: unrun is not green. A missing
// checkout is loud here, because "5 of 7 clean" and "5 clean, 2 never opened" look
// identical in a summary and mean completely different things.
//
// WHERE A CHECKOUT IS LOOKED FOR. The declared path first (the cloud lane's /workspace,
// unchanged, taken as declared). Failing that, the folder of the same name BESIDE this
// checkout — and a sibling counts only when its `origin` remote is exactly OWNER/<expected
// name> (owner AND name, case-insensitively), because a folder of the right name that is
// some other repository (a clone of someone else's same-named repo, or a plain directory
// nested inside one, where `git rev-parse --is-inside-work-tree` is true and `origin` is the
// parent's) would otherwise be scanned and counted clean. A SIBLING that cannot prove its
// identity, or a checkout that cannot be found, is NOT SCANNED — never clean. The estate
// stays DECLARED, not discovered: there is no directory walk and no override variable.
// "Beside this checkout" from a linked worktree is `.claude/worktrees/`, so run it from the
// main checkout.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guarded on being the entry point: importing `locate` or `tally` must not scan the estate.
const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const SELF_TEST = isEntry && process.argv.includes("--self-test");
// check-cited-paths.mjs runs `git ls-files` when it LOADS (via lib/skill-plane.mjs). The
// self-test needs none of it — `locate` and `tally` take their disk and git as arguments —
// so it is not loaded for the self-test, which then runs with git off PATH.
const { repoKeyFromRemote, scanRepo } = SELF_TEST ? {} : await import("./check-cited-paths.mjs");

const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The estate, declared rather than discovered: a scan that silently covers whatever
// happens to be on disk cannot tell you what it missed.
export const ESTATE = [
  { name: "SignalGrid-Review-Hub", path: SELF_ROOT, note: "this repository — the product surface" },
  { name: "signalgrid-mcp", path: "/workspace/signalgrid-mcp", note: "read-only macOS posture MCP server" },
  { name: "signalgrid", path: "/workspace/signalgrid", note: "private core (Replit lineage)" },
  {
    name: "dev",
    path: "/workspace/dev",
    // The real folder name. `dev` only resolves on a case-insensitive filesystem (APFS),
    // so the sibling lookup must not lean on that.
    sibling: "DEV",
    note:
      "legacy alpha lineage, superseded — archived on GitHub and read-only " +
      "(api.github.com `archived: true`, read 2026-10-01)",
    archived: true,
  },
  { name: "signalgrid-inspiration", path: "/workspace/signalgrid-inspiration", note: "private intake source material" },
  { name: "vaultlens", path: "/workspace/danfashauer/vaultlens", note: "separate product" },
  {
    name: "fleet",
    path: "/workspace/fleet",
    note: "fork of fleetdm/fleet — upstream's docs, not this owner's writing",
    upstreamFork: true,
  },
];

// Every sibling must be this owner's: a same-named clone of someone else's repository is
// not the repository being counted. Declared, like the estate (the same owner as the
// SELF_KEY in check-cited-paths.mjs); an owner change fails closed — every sibling reads
// NOT SCANNED until this is updated.
const OWNER = "DanFashauer";

const expectedName = (entry) => entry.sibling ?? basename(entry.path);

// What `origin` points at, as repoKeyFromRemote reports it ({ key, hasOwner }), or
// undefined when there is no origin / git cannot read the directory. Undefined fails
// closed in `locate`.
function gitOriginName(dir) {
  let url;
  try {
    url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
  return repoKeyFromRemote(url);
}

/**
 * Pure (disk and git are injected): where to scan an estate entry, as `{ path }`, or
 * `{ reason }` when it must be reported NOT SCANNED.
 *
 * The declared path wins untouched. Otherwise the sibling folder is used only when its
 * origin remote names `owner/<expected>` — owner and name, case-insensitive (GitHub's are).
 * A local-path origin reads as a bare name, never `owner/name`, so it proves nothing.
 */
export function locate(entry, { exists = existsSync, originName = gitOriginName, owner = OWNER } = {}) {
  if (exists(entry.path)) return { path: entry.path };
  const expected = expectedName(entry);
  const want = `${owner}/${expected}`;
  const sib = resolve(SELF_ROOT, "..", expected);
  if (!exists(sib)) return { reason: `no checkout at ${entry.path} or ${sib}` };
  const got = originName(sib);
  if (got?.key.toLowerCase() !== want.toLowerCase()) {
    const named = got ? `${got.key}${got.hasOwner ? "" : " (a local path, no owner)"}` : "nothing";
    return { reason: `${sib}: origin names ${named}, not ${want}` };
  }
  return { path: sib };
}

// `upstreamFork` WAS DECLARED AND READ NOWHERE. The fleet entry carries
// `upstreamFork: true` with the note "upstream's docs, not this owner's writing",
// and nothing in this file ever consulted it — so fleetdm's own broken README links
// were tallied into one figure with this owner's. Measured 2026-09-06: 26 broken
// citations "in 3 repos", of which 23 were fleet's. The headline number was ~9x the
// thing it was supposed to measure, and a reader could not tell from the summary.
//
// A fork's citations are REPORTED (a broken link is still worth seeing) and never
// gate: nobody here wrote them and nobody here can fix them without diverging from
// upstream. An ARCHIVED repository is the same case from the other side: read-only on
// GitHub, so a broken citation in it can be seen but not fixed, and gating on it would
// leave `pnpm run scan:estate` red forever — a script that is always red gets ignored.
//
// GATED on first-party, writable broken citations only; REPORTED for forks, archived
// repos and repos this checkout could not reach. It used to `console.log` its ✗ rows and
// exit 0 on every path, so `pnpm run scan:estate` printed 26 failures and told its
// caller — and any script wrapping it — that everything was fine.
export function tally(results) {
  const reportOnly = (r) => r.upstreamFork || r.archived;
  const sum = (rs) => rs.reduce((n, r) => n + r.missing.length, 0);
  const broken = results.filter((r) => r.status === "BROKEN");
  const firstPartyBroken = broken.filter((r) => !reportOnly(r));
  const reportOnlyBroken = broken.filter(reportOnly);
  const firstPartyMissing = sum(firstPartyBroken);
  return {
    scanned: results.filter((r) => r.status !== "NOT_SCANNED"),
    unscanned: results.filter((r) => r.status === "NOT_SCANNED"),
    firstPartyBroken,
    reportOnlyBroken,
    firstPartyMissing,
    reportOnlyMissing: sum(reportOnlyBroken),
    exitCode: firstPartyMissing > 0 ? 1 : 0,
  };
}

function selfTest() {
  const throwsIfCalled = () => {
    throw new Error("must not be consulted");
  };
  const entry = { name: "demo", path: "/nowhere-declared/Demo" };
  const sib = resolve(SELF_ROOT, "..", "Demo");
  const only = (p) => (q) => q === p;
  const dev = ESTATE.find((e) => e.name === "dev");
  const row = (over) => ({ name: "x", status: "BROKEN", missing: [{ doc: "d", path: "p" }], ...over });
  // What `origin` reads as: repoKeyFromRemote's shape. `owner: "acme"` is injected so the cases
  // do not lean on the declared OWNER, except the one that proves the default is wired.
  const origin = (key) => () => ({ key, hasOwner: true });
  const opts = (exists, originName) => ({ exists, originName, owner: "acme" });

  const a = locate(entry, opts(only(entry.path), throwsIfCalled));
  const b = locate(entry, opts(only(sib), origin("ACME/demo")));
  const c = locate(entry, opts(() => false, throwsIfCalled));
  const d = locate(entry, opts(only(sib), origin("acme/SignalGrid-Review-Hub")));
  const d2 = locate(entry, opts(only(sib), origin("acme/Demo.mint")));
  const d3 = locate(entry, opts(only(sib), origin("someone-else/Demo")));
  const d4 = locate(entry, opts(only(sib), () => ({ key: "Demo", hasOwner: false })));
  const e = locate(entry, opts(only(sib), () => undefined));
  const devSib = resolve(SELF_ROOT, "..", "DEV");
  const f = locate(dev, opts(only(devSib), origin("acme/DEV")));
  const g = locate(entry, { exists: only(sib), originName: origin(`${OWNER}/Demo`) });
  const notClean = tally([{ name: "nope", status: "NOT_SCANNED", reason: "r" }]);
  const mixed = tally([{ name: "ok", status: "CLEAN", missing: [] }, { name: "nope", status: "NOT_SCANNED", reason: "r" }]);

  const checks = [
    ["(i) declared path present → the declared path, and git is never consulted", a.path === entry.path && !a.reason],
    ["(ii) declared absent, sibling present, origin is owner/name (case-insensitively) → the sibling", b.path === sib && !b.reason],
    [
      "(iii) both absent → a reason naming both places, no path (NOT SCANNED), and git is never consulted",
      !c.path && c.reason.includes(entry.path) && c.reason.includes(sib),
    ],
    [
      "(iv) sibling present but origin names another repo (a clone of something else, or a plain dir nested in another checkout) → NOT SCANNED",
      !d.path && d.reason.includes("origin names acme/SignalGrid-Review-Hub, not acme/Demo"),
    ],
    ["(iv) …and a near-miss name (Demo.mint) is not a match — the name must be exact", !d2.path && !!d2.reason],
    [
      "(iv) …and the right NAME under another OWNER (someone-else/Demo) is not a match — the owner must be ours",
      !d3.path && d3.reason.includes("origin names someone-else/Demo, not acme/Demo"),
    ],
    [
      "(iv) …and a local-path origin (no owner) proves nothing → NOT SCANNED",
      !d4.path && d4.reason.includes("no owner"),
    ],
    ["(v) sibling present with no origin → NOT SCANNED, never scanned on faith", !e.path && e.reason.includes("origin names nothing")],
    ["(ii) …with no owner injected, the declared OWNER is the one required", g.path === sib],
    [
      "(ix) dev is declared with its real folder name DEV and as archived, with the premise dated in its note",
      dev?.sibling === "DEV" && dev.archived === true && /archived: true.*2026-10-01/.test(dev.note) && f.path === devSib,
    ],
    [
      "(vi) tally of an archived BROKEN result → exit 0, counted as reported, not as first-party",
      (() => {
        const t = tally([row({ archived: true })]);
        return t.exitCode === 0 && t.reportOnlyMissing === 1 && t.firstPartyMissing === 0 && t.reportOnlyBroken.length === 1;
      })(),
    ],
    ["(vi) …and an upstream fork's BROKEN result is still report-only (the fork rule did not regress)", tally([row({ upstreamFork: true })]).exitCode === 0],
    [
      "(vii) tally of an unflagged first-party BROKEN result → exit 1",
      (() => {
        const t = tally([row({}), row({ archived: true })]);
        return t.exitCode === 1 && t.firstPartyMissing === 1;
      })(),
    ],
    [
      "(viii) a NOT_SCANNED result is never counted as scanned, clean or broken",
      notClean.scanned.length === 0 && notClean.unscanned.length === 1 && notClean.firstPartyBroken.length === 0 && notClean.exitCode === 0,
    ],
    ["(viii) …and next to a CLEAN one it is still only the clean one that counts as scanned", mixed.scanned.length === 1 && mixed.unscanned.length === 1],
  ];

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — ${name}`);
  console.log(`${failed.length === 0 ? "PASS" : "FAIL"} ${checks.length - failed.length}/${checks.length}`);
  return failed.length === 0 ? 0 : 1;
}

function main() {
  const AS_JSON = process.argv.includes("--json");

  const results = [];
  for (const entry of ESTATE) {
    const loc = locate(entry);
    if (!loc.path) {
      results.push({ ...entry, status: "NOT_SCANNED", reason: loc.reason });
      continue;
    }
    try {
      const r = scanRepo(loc.path);
      results.push({ ...entry, scannedPath: loc.path, status: r.missing.length === 0 ? "CLEAN" : "BROKEN", ...r });
    } catch (err) {
      results.push({ ...entry, status: "NOT_SCANNED", reason: String(err?.message ?? err) });
    }
  }

  const { scanned, unscanned, firstPartyBroken, reportOnlyBroken, firstPartyMissing, reportOnlyMissing, exitCode } = tally(results);
  const totalMissing = firstPartyMissing + reportOnlyMissing;

  if (AS_JSON) {
    console.log(JSON.stringify({ results, firstPartyMissing, reportOnlyMissing, unscanned: unscanned.length }, null, 2));
    process.exit(exitCode);
  }

  console.log("Estate cited-path scan — a document may not point at a file that is not there\n");
  console.log(`  ${"repository".padEnd(24)} ${"status".padEnd(12)} docs  cites  broken`);
  console.log(`  ${"-".repeat(24)} ${"-".repeat(12)} ----  -----  ------`);
  for (const r of results) {
    const docs = r.status === "NOT_SCANNED" ? "—" : String(r.docs);
    const cites = r.status === "NOT_SCANNED" ? "—" : String(r.checked);
    const bad = r.status === "NOT_SCANNED" ? "—" : String(r.missing.length);
    console.log(`  ${r.name.padEnd(24)} ${r.status.padEnd(12)} ${docs.padStart(4)}  ${cites.padStart(5)}  ${bad.padStart(6)}`);
  }

  for (const r of firstPartyBroken) {
    console.log(`\n── ${r.name} — ${r.missing.length} broken citation(s)  [GATED: this owner's writing]`);
    console.log(`   ${r.note}`);
    for (const m of r.missing) console.log(`   ✗ ${m.doc}  →  ${m.path}`);
  }

  for (const r of reportOnlyBroken) {
    const why = r.upstreamFork ? "upstream fork" : "archived upstream, read-only";
    console.log(`\n── ${r.name} — ${r.missing.length} broken citation(s)  [REPORTED, not gated: ${why}]`);
    console.log(`   ${r.note}`);
    for (const m of r.missing) console.log(`   · ${m.doc}  →  ${m.path}`);
  }

  for (const r of scanned) {
    if (r.scannedPath && r.scannedPath !== r.path) console.log(`\n  note: ${r.name} — scanned beside this checkout at ${r.scannedPath} (its origin names ${OWNER}/${expectedName(r)})`);
    if (r.intakeDocs > 0) console.log(`\n  note: ${r.name} — ${r.intakeDocs} pasted/intake document(s) skipped (not this owner's claims)`);
    for (const e of r.exempted ?? []) console.log(`  note: ${r.name} — ${e.doc} exempt, ${e.count} path(s) describing ${e.reason}`);
  }

  if (unscanned.length > 0) {
    console.log(`\n  NOT SCANNED — reported, never counted clean:`);
    for (const r of unscanned) console.log(`    · ${r.name} — ${r.reason}`);
    console.log(`    Clone them under /workspace or beside the main checkout (not a linked worktree: that looks beside itself) and re-run; silence about a repo is not a pass.`);
  }

  console.log(
    `\n${scanned.length}/${ESTATE.length} repositories scanned · ` +
      `${firstPartyMissing} broken citation(s) in ${firstPartyBroken.length} first-party repo(s) [GATED] · ` +
      `${reportOnlyMissing} in ${reportOnlyBroken.length} archived/fork repo(s) [REPORTED] · ${totalMissing} total` +
      (unscanned.length ? ` · ${unscanned.length} NOT SCANNED` : ""),
  );
  if (exitCode !== 0) {
    console.error(
      `\nEstate cited-path scan FAILED: ${firstPartyMissing} broken citation(s) in writing this owner controls.\n` +
        `A document pointing at a file that is not there is read as ground truth by the next agent.`,
    );
  }
  process.exit(exitCode);
}

// The self-test runs BEFORE any scan; `isEntry` is computed at the top of the file.
if (isEntry) {
  if (SELF_TEST) process.exit(selfTest());
  main();
}
