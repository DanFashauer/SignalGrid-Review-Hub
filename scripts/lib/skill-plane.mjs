// The skill plane's two halves, DERIVED from the one document a re-vendor operator
// reads. `.claude/skills/` holds 14 upstream directories copied byte-for-byte from
// obra/superpowers and 12 first-party skills authored in this repository;
// `.claude/skills/VENDORED.md` carries the first-party table and
// `check-publication-boundary.mjs` section E holds the arithmetic.
//
// WHY THIS FILE EXISTS. Four documentation gates (cited paths, markdown links,
// send-copy banners, env-doc readers) exempted the WHOLE directory with the reason
// "vendored third-party work … placeholders in somebody else's prose". True of the
// 14, false of the 12 — and the 12 carried 96 repository-path citations against the
// vendored set's 5. Three of them were dead (`lib/profile.ts` for a file under
// artifacts/api-server, a `tools/` script that never existed) and every gate
// walked past them for as long as the exemption was a literal prefix (twelfth
// audit round, 2026-09-06). The exemption is now the vendored set and nothing else.
//
// FAIL-CLOSED: if the table cannot be parsed, this THROWS. Returning "everything is
// vendored" would silently re-open the hole; returning "nothing is vendored" would
// fail the gates on upstream placeholder paths — loud, but for the wrong reason.
// A broken parser is its own finding.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SKILLS_DIR = ".claude/skills";
export const VENDORED_DOC = `${SKILLS_DIR}/VENDORED.md`;

/** Pure: first-party skill directory names from the VENDORED.md carve-out table text. */
export function firstPartySkillDirsIn(vendoredMd) {
  const out = [];
  for (const line of vendoredMd.split("\n")) {
    const m = /^>\s*\|\s*`([a-z0-9-]+)\/`\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Tracked skill directories (the count VENDORED.md itself names). */
export function trackedSkillDirs(root) {
  const out = execSync(`git ls-files -- ${SKILLS_DIR}`, { cwd: root, encoding: "utf8" });
  const dirs = new Set();
  for (const f of out.split("\n").filter(Boolean)) {
    const seg = f.split("/");
    if (seg.length > 3) dirs.add(seg[2]);
  }
  return [...dirs].sort();
}

/** Pure: the vendored (upstream) directories = tracked − first-party. Throws on an unparseable table. */
export function splitSkillPlane(tracked, vendoredMd) {
  const firstParty = firstPartySkillDirsIn(vendoredMd);
  if (firstParty.length === 0) throw new Error(`${VENDORED_DOC}: the first-party carve-out table parsed to zero rows — refusing to decide what is vendored`);
  const fp = new Set(firstParty);
  const vendored = tracked.filter((d) => !fp.has(d));
  return { firstParty: firstParty.sort(), vendored };
}

/** Path prefixes of the VENDORED skill directories only — what a documentation gate may exempt. */
export function vendoredSkillPrefixes(root) {
  const { vendored } = splitSkillPlane(trackedSkillDirs(root), readFileSync(join(root, VENDORED_DOC), "utf8"));
  return vendored.map((d) => `${SKILLS_DIR}/${d}/`);
}
