// The committed CIS catalog snapshot, loaded fail-closed.
//
// This file turns `cis-catalog.data.ts` into an index that answers exactly two
// questions: is this (title, version) a published row, and is it the highest
// version listed for that title. It cannot answer "is this device hardened" — the
// snapshot carries no rule content, by design.
//
// TITLE IS THE IDENTITY. `family` and `section` are the catalog page's presentation
// buckets and are carried as evidence only. Keying identity on them is not a style
// choice — it is measurably wrong: the catalog files "Microsoft Windows Server 2019
// STIG" v3.0.0 under family "Microsoft Windows Server" and its successor v4.0.0
// under family "DISA STIG". A family-keyed index makes those two separate
// coordinates with one version each, so BOTH read as current and a device graded
// against the superseded v3.0.0 is granted. Doing that hides 3 of the 7 superseded
// rows — the first draft of this file did exactly that, and the count is why it was
// caught.
//
// FOUR PROPERTIES THIS LOADER ENFORCES RATHER THAN DOCUMENTS:
//
// 1. SELF-CHECKING. The snapshot declares its own counts; the loader RE-DERIVES
//    every one from the entries and refuses the file on any disagreement. A
//    snapshot hand-edited, truncated, or half-written cannot load.
// 2. NON-VACUITY. An empty or tiny index must not load: it would answer
//    "not_in_catalog" for every device on earth — a uniform verdict that looks like
//    a working control and is a dead one.
// 3. SUPERSESSION MUST REMAIN REPRESENTABLE. If no title carries two versions, the
//    load fails. A future refresh that "tidies up" duplicates would silently retire
//    the `version_superseded` rung while every proof stayed green.
// 4. THE LICENSING BOUNDARY, MECHANICALLY. Only four keys per row, and values are
//    shape-checked. Rule content ("Ensure 'Minimum password length' is set to 14 or
//    more characters (L1)") fits inside any plausible length bound, so length alone
//    is not the guard — the loader refuses values carrying the grammar of a control
//    statement. A backstop, not a proof: the real guarantee is that the generator
//    emits titles and versions only. It exists so a careless refresh fails loudly.

import { BenchmarkSelectionConnectorError, type CatalogSection } from "./types";
import { CIS_CATALOG_SNAPSHOT } from "./cis-catalog.data";

const SECTIONS: readonly CatalogSection[] = ["current", "disa_stig"];

/** Strict numeric triple. All 454 committed versions conform; a refresh that
 *  introduces any other shape fails the load rather than being silently mis-ordered
 *  by a lenient parser. */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Markers of BENCHMARK RULE CONTENT rather than a benchmark title. A title names a
 *  product and release ("Apple macOS 15.0 Sequoia"); a rule states a setting
 *  ("Ensure 'Minimum password length' is set to 14 or more characters (L1)"). */
const RULE_TEXT_MARKERS =
  /\b(?:ensure|configure|disable|enable|set to|is set|must be|should be|remediation|rationale|audit procedure)\b|\(L[12]\)|\(Automated\)|\(Manual\)/i;

/** Titles are short. A cheap second filter, explicitly NOT the primary boundary
 *  guard — see the note above. */
const MAX_VALUE_LENGTH = 160;

export interface CatalogEntry {
  readonly title: string;
  readonly version: string;
  readonly family: string;
  readonly section: CatalogSection;
}

export interface BenchmarkCatalog {
  readonly asOf: string;
  readonly entries: readonly CatalogEntry[];
  /** Every version listed for a title. Empty set for an unknown title. */
  versionsFor(title: string): ReadonlySet<string>;
  /** The highest listed version for a title, or null if the title is unknown. */
  highestVersionFor(title: string): string | null;
  /** The catalog row for an exact (title, version), or null. */
  rowFor(title: string, version: string): CatalogEntry | null;
  readonly derived: Readonly<Record<string, number>>;
}

function fail(message: string): never {
  throw new BenchmarkSelectionConnectorError("bad_catalog", `benchmark catalog refused: ${message}`);
}

/** Strictly greater-than on the numeric triple. Deliberately NOT string comparison:
 *  "1.10.0" sorts below "1.9.0" lexically, which is the wrong answer. */
export function versionGreater(a: string, b: string): boolean {
  const [a0 = 0, a1 = 0, a2 = 0] = a.split(".").map(Number);
  const [b0 = 0, b1 = 0, b2 = 0] = b.split(".").map(Number);
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

function checkValue(label: string, v: unknown): string {
  if (typeof v !== "string" || v.length === 0) fail(`${label} is not a non-empty string`);
  const s = v;
  if (s.length > MAX_VALUE_LENGTH) fail(`${label} exceeds ${MAX_VALUE_LENGTH} characters`);
  if (RULE_TEXT_MARKERS.test(s)) {
    fail(`${label} carries benchmark rule-content grammar, which is licensed and must not be committed`);
  }
  return s;
}

function buildCatalog(doc: unknown): BenchmarkCatalog {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) fail("snapshot is not an object");
  const d = doc as Record<string, unknown>;
  const asOf = d["asOf"];
  if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail("asOf is not an ISO date");
  const rawEntries = d["entries"];
  if (!Array.isArray(rawEntries)) fail("entries is not an array");

  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const [i, r] of rawEntries.entries()) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) fail(`entry ${i} is not an object`);
    // ONE guard, not two. An arity check plus a per-key name check are two
    // expressions of a single rule ("exactly these four keys"), and the arity check
    // masks the name check completely — a row with a misspelled key has the right
    // arity but a missing required value, so it is refused downstream and the name
    // check can never be the reason. The mutation guard found that second expression
    // unfalsifiable. Set equality states the rule once, and deleting it is caught.
    const keys = Reflect.ownKeys(r as object);
    const allowed = ["title", "version", "family", "section"];
    if (keys.length !== allowed.length || !allowed.every((a) => keys.includes(a))) {
      fail(`entry ${i} does not carry exactly the keys ${allowed.join(", ")}`);
    }
    const e = r as Record<string, unknown>;
    const title = checkValue(`entry ${i} title`, e["title"]);
    const family = checkValue(`entry ${i} family`, e["family"]);
    const version = e["version"];
    if (typeof version !== "string" || !VERSION_RE.test(version)) fail(`entry ${i} version is not a numeric triple`);
    const section = e["section"];
    if (typeof section !== "string" || !(SECTIONS as readonly string[]).includes(section)) {
      fail(`entry ${i} section is not one of ${SECTIONS.join("|")}`);
    }
    // TITLE + VERSION is the primary key — verified unique across all committed rows.
    const pk = `${title}${version}`;
    if (seen.has(pk)) fail(`entry ${i} duplicates the (title, version) primary key`);
    seen.add(pk);
    entries.push({ title, version, family, section: section as CatalogSection });
  }

  // ── the index, keyed on TITLE ────────────────────────────────────────────────
  const byTitle = new Map<string, Set<string>>();
  const byRow = new Map<string, CatalogEntry>();
  for (const e of entries) {
    const set = byTitle.get(e.title) ?? new Set<string>();
    set.add(e.version);
    byTitle.set(e.title, set);
    byRow.set(`${e.title}${e.version}`, e);
  }

  const highestFor = (title: string): string | null => {
    const set = byTitle.get(title);
    if (!set || set.size === 0) return null;
    let best: string | null = null;
    for (const v of set) if (best === null || versionGreater(v, best)) best = v;
    return best;
  };

  // ── re-derive every declared figure; disagreement refuses the file ───────────
  let highestRows = 0;
  for (const e of entries) if (highestFor(e.title) === e.version) highestRows += 1;
  const derived: Record<string, number> = {
    entries: entries.length,
    titles: byTitle.size,
    titlesWithMultipleVersions: [...byTitle.values()].filter((s) => s.size > 1).length,
    highestVersionRows: highestRows,
    supersededRows: entries.length - highestRows,
    families: new Set(entries.map((e) => e.family)).size,
    sectionCurrent: entries.filter((e) => e.section === "current").length,
    sectionDisaStig: entries.filter((e) => e.section === "disa_stig").length,
  };

  const declared = d["derived"];
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) fail("derived block is missing");
  for (const [k, v] of Object.entries(derived)) {
    const claimed = (declared as Record<string, unknown>)[k];
    if (claimed !== v) fail(`declared ${k}=${String(claimed)} but the entries derive ${v}`);
  }

  // ── non-vacuity + representability floors ───────────────────────────────────
  if (entries.length < 400) fail(`only ${entries.length} entries loaded; the snapshot is not plausibly complete`);
  if (derived.titles < 400) fail(`only ${derived.titles} distinct titles loaded`);
  if (derived.supersededRows < 1) {
    fail("no title carries more than one version; a de-duplicated snapshot would retire the version_superseded rung while every proof stayed green");
  }

  return {
    asOf,
    entries,
    derived: Object.freeze(derived),
    versionsFor: (title) => byTitle.get(title) ?? new Set<string>(),
    highestVersionFor: highestFor,
    rowFor: (title, version) => byRow.get(`${title}${version}`) ?? null,
  };
}

let cached: BenchmarkCatalog | null = null;

/** The committed snapshot. Built once; a refusal throws every time rather than
 *  caching a broken index. */
export function loadBenchmarkCatalog(): BenchmarkCatalog {
  if (cached === null) cached = buildCatalog(CIS_CATALOG_SNAPSHOT as unknown);
  return cached;
}

/** Build a catalog from an arbitrary document — for proofs and negative controls.
 *  Throws `BenchmarkSelectionConnectorError("bad_catalog")` on anything it refuses. */
export function buildBenchmarkCatalog(doc: unknown): BenchmarkCatalog {
  return buildCatalog(doc);
}
