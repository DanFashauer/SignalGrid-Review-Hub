#!/usr/bin/env node
// Licence-policy gate over the committed CycloneDX SBOM (legal next-work;
// owned by the Open-Source Licensing and IP Steward, docs/company/ROLE_CATALOG.md).
// Every component's licence must resolve to a DECLARED class with a stated
// reason — allow, review, or deny — and the gate fails on anything else:
//
//   FAIL  — a deny-class licence anywhere in the tree; a licence family this
//           registry has never ruled on (unlisted reads as harmless, and this
//           is where that stops); an expression that does not parse; a
//           component with NO licence entry that is not individually named in
//           REVIEW_COMPONENTS below.
//   REVIEW, exit 0 — review-class licences and the individually-named
//           unresolved components: printed IN FULL on every run, never
//           summarised (the OWNER_PENDING convention from
//           scripts/check-publication-boundary.mjs) — pending is visible
//           pending, not a buried count.
//
// SPDX expression handling: OR takes the BEST class among alternatives (a
// dual-licensed package is used under the friendlier grant — the standard
// reading); AND and WITH take the WORST (every part binds).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SBOM = "artifacts/sbom/cyclonedx.json";

// Floor below which the SBOM cannot be real: npm alone contributes ~523
// components and cargo ~420. A collapse under this line means the generator
// broke, and a gate reading an empty bill must fail rather than pass it.
const VACUITY_FLOOR = 900;

export const POLICY = {
  allow: {
    "MIT": "permissive, attribution only",
    "MIT-0": "MIT with even the attribution clause waived",
    "ISC": "permissive, MIT-equivalent",
    "Apache-2.0": "permissive with patent grant",
    "Apache-2.0 WITH LLVM-exception": "Apache-2.0; the exception only relaxes it",
    "BSD-2-Clause": "permissive, attribution only",
    "BSD-3-Clause": "permissive, attribution + no-endorsement",
    "0BSD": "public-domain-equivalent",
    "Unlicense": "public-domain dedication",
    "CC0-1.0": "public-domain dedication",
    "WTFPL": "public-domain-equivalent",
    "Zlib": "permissive, attribution in source only",
    "BSL-1.0": "Boost licence — permissive, no attribution in binaries",
    "Python-2.0": "permissive PSF terms",
    "PSF-2.0": "permissive PSF terms",
    "OFL-1.1": "fonts only; permits embedding and redistribution",
    "BlueOak-1.0.0": "modern permissive, MIT-equivalent in effect",
    "CC-BY-4.0": "attribution-only; used here for data/doc packages",
    "CC-BY-3.0": "attribution-only; used here for data/doc packages",
    "Unicode-3.0": "permissive Unicode data-file terms",
    "Unicode-DFS-2016": "permissive Unicode data-file terms",
    "MPL-2.0":
      "file-level copyleft; we do not modify MPL-licensed files, so the " +
      "obligation to publish modifications never attaches",
  },
  review: {
    "LGPL-2.1": "weak copyleft — fine when dynamically linked; counsel confirms per use",
    "LGPL-2.1-only": "weak copyleft — fine when dynamically linked; counsel confirms per use",
    "LGPL-2.1-or-later": "weak copyleft — fine when dynamically linked; counsel confirms per use",
    "LGPL-3.0": "weak copyleft — fine when dynamically linked; counsel confirms per use",
    "EPL-1.0": "weak copyleft with patent-retaliation terms; counsel confirms per use",
    "EPL-2.0": "weak copyleft with patent-retaliation terms; counsel confirms per use",
    "CDDL-1.0": "weak copyleft; counsel confirms per use",
    "CDDL-1.1": "weak copyleft; counsel confirms per use",
    "Artistic-2.0": "permissive-ish but unusual terms; counsel confirms per use",
    "JSON": "'shall be used for Good, not Evil' — non-standard field-of-use text",
    "BUSL-1.1": "source-available, not open source; usage grant must be read per package",
  },
  deny: {
    "GPL-2.0": "strong copyleft — linking obligations incompatible with the product's licensing; owner + counsel decision required to admit",
    "GPL-2.0-only": "strong copyleft — see GPL-2.0",
    "GPL-2.0-or-later": "strong copyleft — see GPL-2.0",
    "GPL-3.0": "strong copyleft — see GPL-2.0",
    "GPL-3.0-only": "strong copyleft — see GPL-2.0",
    "GPL-3.0-or-later": "strong copyleft — see GPL-2.0",
    "AGPL-3.0": "network copyleft — triggers on serving, the exact thing this product does",
    "AGPL-3.0-only": "network copyleft — see AGPL-3.0",
    "AGPL-3.0-or-later": "network copyleft — see AGPL-3.0",
    "SSPL-1.0": "service-source obligations; not an OSI licence",
    "CC-BY-NC-4.0": "non-commercial restriction; this is a commercial product",
  },
};

// Components allowed to carry NO licence entry, each a NAMED, dated unknown
// with the reason it is unresolved and what closes it. Anything unresolved
// and NOT in this list fails the gate — an unnamed unknown is a silent one.
export const REVIEW_COMPONENTS = {
  // The committed registry scripts/data/third-party-licences.json resolves
  // every cargo/maven component and the uninstalled npm platform binaries; a
  // lockfile bump that outruns the registry lands here, by name, until the
  // recorder is re-run — or, as below, until upstream actually grants one.
  "pkg:npm/json-query@2.2.2":
    "upstream declares NO licence in any npm metadata (version manifest and " +
    "packument both empty, verified 2026-08-21); a transitive dependency of " +
    "@usebruno/cli (dev-only, never shipped). Closes when upstream publishes " +
    "a licence field or counsel reviews the repository's LICENSE file for reuse.",
};

const CLASS_RANK = { allow: 0, review: 1, deny: 2 };

/** Classify one SPDX atom. Returns {cls, reason} or null if unlisted. */
function classifyAtom(atom, policy) {
  // Placeholder for an already-resolved parenthesised group (see below).
  const m = /^__group-(allow|review|deny)__$/.exec(atom);
  if (m) return { cls: m[1], reason: "resolved parenthesised group" };
  for (const cls of ["allow", "review", "deny"]) {
    if (atom in policy[cls]) return { cls, reason: policy[cls][atom] };
  }
  return null;
}

/**
 * Classify a licence string (id or SPDX expression).
 * Returns { cls, reason } or { unlisted: [atoms] } or { unparsed: true }.
 */
export function classifyLicence(text, policy) {
  const direct = classifyAtom(text, policy);
  if (direct) return direct;
  // Legacy cargo notation: "MIT/Apache-2.0" (and "MIT / Apache-2.0") is the
  // pre-SPDX spelling of OR — cargo's own docs deprecated it in favour of
  // "MIT OR Apache-2.0". No real SPDX id contains a slash, so this is safe.
  const slashNormalised = text.replaceAll("/", " OR ");
  // Parenthesised groups: resolve the innermost group first, substitute a
  // placeholder atom carrying its class, and recurse — so
  // "(MIT OR Apache-2.0) AND Unicode-3.0" classifies instead of refusing.
  const group = /\(([^()]+)\)/.exec(slashNormalised);
  if (group) {
    const inner = classifyLicence(group[1].trim(), policy);
    if (inner.unparsed || inner.unlisted) return inner;
    const rest = slashNormalised.replace(group[0], `__group-${inner.cls}__`);
    const outer = classifyLicence(rest.trim(), policy);
    if (outer.unparsed || outer.unlisted) return outer;
    // The reason survives from whichever side decided the class.
    return outer.cls === inner.cls && CLASS_RANK[inner.cls] >= CLASS_RANK[outer.cls]
      ? { cls: outer.cls, reason: inner.reason }
      : outer;
  }
  const tokens = slashNormalised.trim().split(/\s+/);
  const atoms = [];
  const ops = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "AND" || t === "OR") {
      ops.push(t);
    } else if (t === "WITH") {
      if (atoms.length === 0 || i + 1 >= tokens.length) return { unparsed: true };
      atoms[atoms.length - 1] = `${atoms[atoms.length - 1]} WITH ${tokens[i + 1]}`;
      i += 1;
    } else {
      atoms.push(t);
    }
  }
  if (atoms.length === 0) return { unparsed: true };
  const classified = atoms.map((a) => ({ atom: a, hit: classifyAtom(a, policy) }));
  const unlisted = classified.filter((c) => !c.hit).map((c) => c.atom);
  if (unlisted.length > 0) return { unlisted };
  // Mixed AND/OR without parentheses is ambiguous — refuse to guess.
  const kinds = new Set(ops);
  if (kinds.size > 1) return { unparsed: true };
  const rank = (c) => CLASS_RANK[c.hit.cls];
  const pick =
    kinds.has("OR")
      ? classified.reduce((a, b) => (rank(a) <= rank(b) ? a : b)) // best
      : classified.reduce((a, b) => (rank(a) >= rank(b) ? a : b)); // worst
  return { cls: pick.hit.cls, reason: `${pick.atom}: ${pick.hit.reason}` };
}

export function auditLicences(bom, policy, reviewComponents) {
  const fatal = [];
  const review = [];
  const components = bom?.components;
  if (!Array.isArray(components)) return { fatal: [`${SBOM} carries no components array`], review };
  if (components.length < VACUITY_FLOOR) {
    fatal.push(
      `only ${components.length} components — below the ${VACUITY_FLOOR} vacuity floor; ` +
        "the generator has collapsed and an empty bill must not read as a clean one",
    );
  }
  for (const c of components) {
    const ref = c.purl ?? c["bom-ref"] ?? `${c.name}@${c.version}`;
    const licences = c.licenses;
    if (!Array.isArray(licences) || licences.length === 0) {
      const named = reviewComponents[ref];
      if (named) {
        review.push(`UNRESOLVED (named) ${ref} — ${named}`);
      } else {
        fatal.push(`${ref}: no licence entry and not individually named in REVIEW_COMPONENTS — an unnamed unknown`);
      }
      continue;
    }
    for (const entry of licences) {
      const text = entry.expression ?? entry.license?.id ?? entry.license?.name;
      if (!text) {
        fatal.push(`${ref}: licence entry with neither expression nor id/name`);
        continue;
      }
      const verdict = classifyLicence(text, policy);
      if (verdict.unparsed) {
        fatal.push(`${ref}: licence "${text}" does not parse as an SPDX id or expression`);
      } else if (verdict.unlisted) {
        fatal.push(
          `${ref}: licence family [${verdict.unlisted.join(", ")}] has never been ruled on — ` +
            "add it to the POLICY registry with a stated reason (unlisted must not read as harmless)",
        );
      } else if (verdict.cls === "deny") {
        fatal.push(`${ref}: DENY-class licence "${text}" — ${verdict.reason}`);
      } else if (verdict.cls === "review") {
        review.push(`REVIEW ${ref} — "${text}" — ${verdict.reason}`);
      }
    }
  }
  return { fatal, review };
}

function selfTest() {
  const checks = [];
  const mk = (comps) => ({ components: comps });
  const pad = Array.from({ length: 950 }, (_, i) => ({
    purl: `pkg:npm/pad-${i}@1.0.0`,
    licenses: [{ license: { id: "MIT" } }],
  }));
  let r = auditLicences(mk(pad), POLICY, {});
  checks.push(["a clean all-MIT bill passes with nothing to review", r.fatal.length === 0 && r.review.length === 0]);
  r = auditLicences(mk([...pad, { purl: "pkg:npm/x@1", licenses: [{ license: { id: "AGPL-3.0-only" } }] }]), POLICY, {});
  checks.push(["a deny-class licence is FATAL", r.fatal.some((x) => x.includes("DENY-class"))]);
  r = auditLicences(mk([...pad, { purl: "pkg:npm/x@1", licenses: [{ license: { id: "Made-Up-1.0" } }] }]), POLICY, {});
  checks.push(["an unlisted licence family is FATAL — unlisted must not read as harmless", r.fatal.some((x) => x.includes("never been ruled on"))]);
  r = auditLicences(mk([...pad, { purl: "pkg:cargo/x@1" }]), POLICY, {});
  checks.push(["an unresolved licence with no named entry is FATAL", r.fatal.some((x) => x.includes("unnamed unknown"))]);
  r = auditLicences(mk([...pad, { purl: "pkg:cargo/x@1" }]), POLICY, { "pkg:cargo/x@1": "lockfile carries no licence; recorder pending" });
  checks.push(["a NAMED unresolved component is REVIEW, printed, exit 0", r.fatal.length === 0 && r.review.some((x) => x.includes("UNRESOLVED (named)"))]);
  r = auditLicences(mk([...pad, { purl: "pkg:npm/x@1", licenses: [{ expression: "MIT OR GPL-3.0-only" }] }]), POLICY, {});
  checks.push(["OR takes the best class — dual-licensed MIT OR GPL is allow", r.fatal.length === 0]);
  r = auditLicences(mk([...pad, { purl: "pkg:npm/x@1", licenses: [{ expression: "MIT AND GPL-3.0-only" }] }]), POLICY, {});
  checks.push(["AND takes the worst class — MIT AND GPL is deny", r.fatal.some((x) => x.includes("DENY-class"))]);
  r = auditLicences(mk([...pad, { purl: "pkg:npm/x@1", licenses: [{ expression: "Apache-2.0 WITH LLVM-exception" }] }]), POLICY, {});
  checks.push(["a WITH exception listed in the registry classifies", r.fatal.length === 0]);
  r = auditLicences(mk([...pad, { purl: "pkg:npm/x@1", licenses: [{ license: { id: "BUSL-1.1" } }] }]), POLICY, {});
  checks.push(["a review-class licence is printed and exits 0", r.fatal.length === 0 && r.review.some((x) => x.includes("BUSL-1.1"))]);
  r = auditLicences(mk([...pad, { purl: "pkg:cargo/x@1", licenses: [{ license: { name: "MIT/Apache-2.0" } }] }]), POLICY, {});
  checks.push(["legacy cargo slash notation reads as OR — MIT/Apache-2.0 is allow", r.fatal.length === 0]);
  r = auditLicences(mk([...pad, { purl: "pkg:cargo/x@1", licenses: [{ expression: "(MIT OR Apache-2.0) AND Unicode-3.0" }] }]), POLICY, {});
  checks.push(["a parenthesised group resolves — (MIT OR Apache-2.0) AND Unicode-3.0 is allow", r.fatal.length === 0]);
  r = auditLicences(mk([...pad, { purl: "pkg:cargo/x@1", licenses: [{ expression: "(MIT OR GPL-3.0-only) AND GPL-3.0-only" }] }]), POLICY, {});
  checks.push(["a deny outside a friendly group still denies", r.fatal.some((x) => x.includes("DENY-class"))]);
  r = auditLicences(mk(pad.slice(0, 10)), POLICY, {});
  checks.push(["a collapsed bill under the vacuity floor is FATAL", r.fatal.some((x) => x.includes("vacuity floor"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const bom = JSON.parse(readFileSync(SBOM, "utf8"));
  const { fatal, review } = auditLicences(bom, POLICY, REVIEW_COMPONENTS);
  console.log(`Licence policy — ${bom.components?.length ?? 0} components audited`);
  for (const r of review) console.log(`  · ${r}`);
  if (review.length > 0) {
    console.log(`  (${review.length} review-class item(s) — listed in full above, pending is visible pending)`);
  }
  if (fatal.length > 0) {
    console.error(`Licence-policy check FAILED: ${fatal.length} violation(s).`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Licence-policy check passed — every component's licence resolves to a declared class with a stated reason.");
}
