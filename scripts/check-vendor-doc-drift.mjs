#!/usr/bin/env node
// check-vendor-doc-drift.mjs — REPORT-ONLY. Never fails a pull request.
//
//   node scripts/check-vendor-doc-drift.mjs              # report
//   node scripts/check-vendor-doc-drift.mjs --write       # regenerate the
//                                                          # manifest's newly-cited URLs
//   node scripts/check-vendor-doc-drift.mjs --self-test   # prove the logic works
//
// BUILD_BACKLOG.md row: "Vendor-doc drift is unwatched — decide whether a
// report-only watcher is worth its operator machine." Decided: yes, but
// cheaper than the changedetection.io shape the row proposed. That shape
// fetches every vendor page on a schedule and needs a machine to run on;
// this repo makes no network calls by design (CLAUDE.md: fixture-backed,
// no live vendor call). What we CAN do for free, offline, in CI: every row
// of docs/inspiration/ENDPOINT_MANAGEMENT_API_CATALOG.md already carries a
// verified date per vendor URL. `docs/agent/VENDOR_DOC_MANIFEST.json` is a
// committed ledger of "when was this URL last actually re-checked" —
// separate from the catalog's own date column, because that column moves as
// ONE snapshot for the whole document while individual URLs get re-verified
// (or found dead — see CyberArk -> Idira, `privx-ot` 404, both recorded by
// hand in the catalogs already) at their own pace.
//
// This script never fetches a URL. It only compares two committed texts:
// the catalog's current URL set against the manifest's dated one, and
// reports (a) URLs newly cited that have no manifest entry yet, (b) URLs
// the manifest has that the catalog no longer cites, and (c) URLs whose
// manifest date is more than 90 days old. All three are REPORTED, never
// FATAL — an operator reads the report and decides whether to re-verify a
// link by hand, exactly the "look at it" outcome the row asked for, minus
// the machine.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = join(repo, "docs/inspiration/ENDPOINT_MANAGEMENT_API_CATALOG.md");
const MANIFEST_PATH = join(repo, "docs/agent/VENDOR_DOC_MANIFEST.json");
/** One read, no check-then-open: a manifest that is not there yet is an empty ledger; any other failure is real. */
function readManifestOrEmpty() {
  try {
    return loadManifest(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (e) {
    if (e && e.code === "ENOENT") return new Map();
    throw e;
  }
}
const STALE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every markdown-table row that cites at least one URL ends its cells with
 * that row's verified date (asserted by the catalog's own header row: the
 * last column of every data table is "Verified Date"). Rows that don't fit
 * that shape are skipped, never guessed at. */
export function extractCatalogUrls(text) {
  const urls = new Map(); // url -> verified date (YYYY-MM-DD) from the catalog's own column
  for (const line of text.split("\n")) {
    if (!line.startsWith("|") || !line.includes("http")) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|");
    const last = cells[cells.length - 1].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(last)) continue; // not a data row shaped like the others
    for (const cell of cells) {
      for (const match of cell.match(/https?:\/\/\S+/g) ?? []) {
        const url = match.replace(/[.,;)]+$/, "");
        if (!urls.has(url)) urls.set(url, last);
      }
    }
  }
  return urls;
}

export function loadManifest(text) {
  const parsed = JSON.parse(text);
  return new Map(Object.entries(parsed.urls ?? {}));
}

function daysSince(dateStr, nowMs) {
  const then = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(then)) return null;
  return Math.floor((nowMs - then) / DAY_MS);
}

/** The comparison this whole gate exists to make. Pure, so the self-test can
 * drive it without touching the filesystem or the clock. */
export function computeDrift(catalogUrls, manifestUrls, nowMs, staleDays = STALE_DAYS) {
  const unverified = [];
  const stale = [];
  for (const [url] of catalogUrls) {
    if (!manifestUrls.has(url)) {
      unverified.push(url);
      continue;
    }
    const days = daysSince(manifestUrls.get(url), nowMs);
    if (days === null || days > staleDays) stale.push({ url, date: manifestUrls.get(url), days });
  }
  const removed = [...manifestUrls.keys()].filter((url) => !catalogUrls.has(url));
  stale.sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity));
  return { unverified: unverified.sort(), stale, removed: removed.sort() };
}

function selfTest() {
  const checks = [];
  const T0 = Date.parse("2026-09-18T00:00:00Z");

  const catalog = extractCatalogUrls(
    "|a|https://ok.example/one|2026-08-01|\n" +
      "|b|https://ok.example/two also https://ok.example/three|2026-08-01|\n" +
      "|c|no url here|not-a-date|\n" +
      "not a table row at all https://ignored.example\n",
  );
  checks.push(["extracts every URL from a row shaped like the catalog's", catalog.size === 3]);
  checks.push(["skips a row whose last cell isn't a date", !catalog.has("https://ignored.example")]);
  checks.push(["reads the row's own last-cell date as that URL's date", catalog.get("https://ok.example/one") === "2026-08-01"]);

  // 90 days is the boundary: exactly 90 is NOT stale, 91 is.
  const boundary = extractCatalogUrls("|a|https://x.example/at-boundary|2026-06-20|\n|a|https://x.example/over-boundary|2026-06-19|\n");
  let d = computeDrift(boundary, new Map([["https://x.example/at-boundary", "2026-06-20"], ["https://x.example/over-boundary", "2026-06-19"]]), T0);
  checks.push(["exactly 90 days is not stale", d.stale.every((s) => s.url !== "https://x.example/at-boundary")]);
  checks.push(["91 days is stale", d.stale.some((s) => s.url === "https://x.example/over-boundary")]);

  // A URL the catalog cites but the manifest has never seen: unverified, not stale.
  d = computeDrift(new Map([["https://new.example/", "2026-09-01"]]), new Map(), T0);
  checks.push(["a URL missing from the manifest is reported unverified", d.unverified.some((u) => u === "https://new.example/")]);
  checks.push(["…and never double-counted as stale", d.stale.length === 0]);

  // A URL the manifest has but the catalog no longer cites.
  d = computeDrift(new Map(), new Map([["https://gone.example/", "2026-01-01"]]), T0);
  checks.push(["a manifest URL absent from the catalog is reported removed", d.removed.some((u) => u === "https://gone.example/")]);

  // An unparseable manifest date reads as stale, never as fresh — same law
  // check-lane-messages.mjs applies to sentAt: absent/corrupt evidence is
  // never treated as more current than it is.
  d = computeDrift(new Map([["https://bad.example/", "2026-08-01"]]), new Map([["https://bad.example/", "not-a-date"]]), T0);
  checks.push(["an unparseable manifest date is treated as stale, never fresh", d.stale.some((s) => s.url === "https://bad.example/" && s.days === null)]);

  // Never fatal: computeDrift/extractCatalogUrls never throw or return a
  // "problems" field that could fail a build — this loop is the whole
  // contract; there is nothing else to assert.
  checks.push(["computeDrift's result carries no 'problems'/'errors' field to fail a build on", !("problems" in d) && !("errors" in d)]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const catalogText = readFileSync(CATALOG_PATH, "utf8");
const catalogUrls = extractCatalogUrls(catalogText);

if (process.argv.includes("--write")) {
  const manifestUrls = readManifestOrEmpty();
  let added = 0;
  for (const [url, verifiedDate] of catalogUrls) {
    if (!manifestUrls.has(url)) {
      manifestUrls.set(url, verifiedDate);
      added++;
    }
  }
  const out = {
    _comment:
      "Committed ledger of when each vendor URL in docs/inspiration/ENDPOINT_MANAGEMENT_API_CATALOG.md was last actually verified. " +
      "New URLs are added by `node scripts/check-vendor-doc-drift.mjs --write` (using the catalog's own date for that row); " +
      "an EXISTING url's date is bumped only by hand, after a person actually re-checks that link — --write never rewrites one on its own.",
    urls: Object.fromEntries([...manifestUrls.entries()].sort()),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Vendor-doc manifest: added ${added} new URL(s), ${manifestUrls.size} total. Written to ${MANIFEST_PATH}.`);
  process.exit(0);
}

const manifestUrls = readManifestOrEmpty();
const { unverified, stale, removed } = computeDrift(catalogUrls, manifestUrls, Date.now());

console.log(`Vendor-doc drift watch (report-only) — ${catalogUrls.size} URL(s) cited, ${manifestUrls.size} in the manifest.`);
if (unverified.length > 0) {
  console.log(`\n  UNVERIFIED — cited but not yet in the manifest (run --write to add at the catalog's date): ${unverified.length}`);
  for (const u of unverified) console.log(`    · ${u}`);
}
if (stale.length > 0) {
  console.log(`\n  STALE — last verified more than ${STALE_DAYS} days ago, or the date could not be read: ${stale.length}`);
  for (const s of stale) console.log(`    · ${s.url} — ${s.date} (${s.days === null ? "unreadable date" : `${s.days}d ago`})`);
}
if (removed.length > 0) {
  console.log(`\n  IN THE MANIFEST BUT NO LONGER CITED — the catalog dropped these: ${removed.length}`);
  for (const r of removed) console.log(`    · ${r}`);
}
if (unverified.length === 0 && stale.length === 0 && removed.length === 0) {
  console.log("\n  Nothing to report — every cited URL is in the manifest and under 90 days old.");
}
console.log("\nReport-only: this never fails a build. An operator reads the report and decides what to re-verify by hand.");
process.exit(0);
