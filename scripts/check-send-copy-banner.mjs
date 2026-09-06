#!/usr/bin/env node
// Send-copy banner — a document holding a ready-to-send email must be inside the
// buyer-facing claim scan or say, in its banner, that it is not to be sent from.
//
// WHY. `check-launch-claims.mjs` scans `docs/outreach/` fatally because that is
// what reaches a stranger as real mail. Two files in `docs/research/` that also
// held send-ready copy were bannered "SUPERSEDED — do not send from this file" on
// 2026-08-23. A third, `STRATEGIC_BUYER_PARTNER_PITCH_PACK.md`, still carried a
// ready subject line naming a retired category label, no banner, and an index
// entry describing it as live positioning (tenth-round docs audit, 2026-09-06).
// The launch-claims scan cannot reach it — its cited-name resolution looks only
// under `docs/` — and the retired-label ceiling counts mentions, not readiness to
// send. This gate holds the one unambiguous property: a `Subject:` line is a
// template, and a template lives either in the scanned outreach set or under a
// do-not-send banner. Prose ABOUT subject lines does not start a line with
// `Subject:`; a quoted competitor's subject line inside a code fence is skipped.
//
//   node scripts/check-send-copy-banner.mjs [--self-test]

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BANNER } from "./check-index-banner-parity.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The set the launch-claims gate scans fatally — send-ready copy belongs there. */
export const SCANNED_PREFIX = "docs/outreach/";
const SKIP_PREFIXES = ["attached_assets/", "vendor/", "third_party/", ".claude/skills/"];
export const SUBJECT_LINE = /^\s*(?:\*\*)?Subject:/;
export const BANNER_WINDOW = 30;

/** Pure: does this document hold a send template outside a code fence? */
export function hasSendTemplate(text) {
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && SUBJECT_LINE.test(line)) return true;
  }
  return false;
}

/** Pure: does the first BANNER_WINDOW lines carry a status banner (the index-parity gate's shape)? */
export function hasBanner(text) {
  return text.split("\n").slice(0, BANNER_WINDOW).some((l) => BANNER.test(l));
}

/** Pure audit: docs is { [rel]: text }. */
export function auditSendCopy(docs) {
  const fatal = [];
  let templates = 0;
  let bannered = 0;
  let scanned = 0;
  for (const [rel, text] of Object.entries(docs)) {
    if (!hasSendTemplate(text)) continue;
    templates += 1;
    if (rel.startsWith(SCANNED_PREFIX)) {
      scanned += 1;
      continue;
    }
    if (hasBanner(text)) {
      bannered += 1;
      continue;
    }
    fatal.push(`${rel} holds a ready-to-send template (a \`Subject:\` line) outside ${SCANNED_PREFIX} and carries no do-not-send banner in its first ${BANNER_WINDOW} lines — a stranger can be mailed from it and no claim gate reads it`);
  }
  return { fatal, templates, bannered, scanned };
}

function loadDocs() {
  const out = {};
  const files = execSync("git ls-files -- '*.md'", { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const rel of files) {
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    try {
      out[rel] = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      out[rel] = "";
    }
  }
  return out;
}

function selfTest() {
  const checks = [];
  const tpl = "# Pack\n\nSubject: SignalGrid discussion\n\nHi …\n";
  let r = auditSendCopy({ "docs/outreach/TEMPLATES.md": tpl });
  checks.push(["a template inside the scanned outreach set passes (positive control)", r.fatal.length === 0 && r.scanned === 1]);
  r = auditSendCopy({ "docs/research/PACK.md": tpl });
  checks.push(["THE PLANTED MISS: a template outside the scanned set with no banner is FATAL", r.fatal.length === 1 && r.fatal[0].includes("docs/research/PACK.md")]);
  r = auditSendCopy({ "docs/research/PACK.md": "> **SUPERSEDED 2026-09-06 — do not send from this file.**\n\n" + tpl });
  checks.push(["…and the same document under a do-not-send banner is reported, not failed", r.fatal.length === 0 && r.bannered === 1]);
  r = auditSendCopy({ "docs/research/BRIEF.md": "Their mail opened with\n```\nSubject: buy now\n```\nwhich we do not copy.\n" });
  checks.push(["a subject line quoted inside a code fence is not a template", r.fatal.length === 0 && r.templates === 0]);
  r = auditSendCopy({ "docs/research/BRIEF.md": "The subject line should say what the meeting is for.\n" });
  checks.push(["prose ABOUT a subject line is not a template", r.templates === 0]);
  r = auditSendCopy({ "docs/research/PACK.md": "# Pack\n" + "filler\n".repeat(31) + "> **SUPERSEDED — do not send.**\n" + tpl });
  checks.push(["a banner below the window does not count — the window is the index-parity gate's", r.fatal.length === 1]);
  const live = auditSendCopy(loadDocs());
  checks.push(["LIVE: the tree holds send templates, and every one outside the scanned set is bannered", live.templates >= 2 && live.fatal.length === 0]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const r = auditSendCopy(loadDocs());
  console.log(`Send-copy banner — ${r.templates} document(s) hold a \`Subject:\` template: ${r.scanned} inside ${SCANNED_PREFIX} (claim-scanned), ${r.bannered} bannered do-not-send.`);
  if (r.fatal.length > 0) {
    console.error(`\nSend-copy-banner check FAILED: ${r.fatal.length} problem(s).`);
    for (const f of r.fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Send-copy-banner check passed — every send template is claim-scanned or bannered do-not-send.");
}
