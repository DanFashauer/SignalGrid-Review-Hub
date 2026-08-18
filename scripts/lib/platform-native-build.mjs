// Can the native web build run on THIS machine — and if not, is that a defect or
// a decision this repository already made on purpose?
//
// `pnpm-workspace.yaml` deletes every native platform binary except linux-x64-gnu:
//
//     "rollup>@rollup/rollup-darwin-arm64": "-"
//     # CI and deploy run on linux-x64 only, so we can exclude all other platforms
//
// That is deliberate and good — it keeps the install small and the supply-chain
// surface narrow. But it has a consequence nobody wrote down: `pnpm run build`
// CANNOT succeed on macOS from a clean install, because rollup will look for a
// binary the workspace config removed.
//
// Which collided with a rule elsewhere: live evidence may be minted ONLY on macOS
// (a cloud runner is not the owner's managed Mac), and minting runs the FULL
// preflight — including that build. So evidence required a step the toolchain
// forbids on the only platform allowed to produce it. The Mac lane could never
// have gone green, and `liveEvidence: none` was the symptom, not the cause.
//
// This resolves it WITHOUT weakening anything, by distinguishing two things a
// naive skip would conflate:
//
//   · "this step failed"           → a defect. Still fails. Always.
//   · "this step is structurally
//      impossible here, per the
//      repo's own committed config" → recorded as skipped, WITH the reason.
//
// Three properties make that honest rather than convenient:
//
//   1. DERIVED, NOT DECLARED. The exclusion is read out of pnpm-workspace.yaml at
//      run time. Nobody can mark a step skippable by editing a list here; the
//      workspace config is the only authority, and CI reads the same file.
//   2. ONLY WHEN GENUINELY ABSENT. A config exclusion is not enough — the binary
//      must also fail to resolve. Supply the darwin binaries and the build RUNS,
//      for real, and this returns "not excluded". The escape closes itself the
//      moment it stops being needed.
//   3. CANNOT FIRE ON THE PLATFORM THAT MATTERS. On linux-x64 the binaries are
//      present by design, so this always returns "not excluded" and the build is
//      mandatory in CI exactly as before.
//
// A skip nobody can see is a lie by omission, so callers are expected to SURFACE
// what this returns — preflight prints it, and the evidence file records it.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The five native families the workspace strips. Each entry maps the override
// prefix used in pnpm-workspace.yaml to the package name pattern.
const NATIVE_FAMILIES = [
  { parent: "rollup", pkg: (t) => `@rollup/rollup-${t}` },
  { parent: "rolldown", pkg: (t) => `@rolldown/binding-${t}` },
  { parent: "esbuild", pkg: (t) => `@esbuild/${t}` },
  { parent: "lightningcss", pkg: (t) => `lightningcss-${t}` },
  { parent: "@tailwindcss/oxide", pkg: (t) => `@tailwindcss/oxide-${t}` },
];

// node's process.arch → the triple fragment these packages use.
const ARCH = { arm64: "arm64", x64: "x64", ia32: "ia32", arm: "arm" };

/**
 * @returns {{excluded: boolean, target: string, packages: string[], reason: string|null}}
 *   excluded  — true when the native web build provably cannot run here
 *   target    — the platform triple probed, e.g. "darwin-arm64"
 *   packages  — config-excluded AND unresolvable packages (the actual blockers)
 *   reason    — human-readable explanation, or null when the build can run
 */
export function nativeBuildExclusion(repoRoot) {
  const target = `${process.platform}-${ARCH[process.arch] ?? process.arch}`;

  let workspace = "";
  try {
    workspace = readFileSync(resolve(repoRoot, "pnpm-workspace.yaml"), "utf8");
  } catch {
    // No workspace file to read means no evidence of an exclusion. Fail toward
    // running the build: a missing config must never buy a skip.
    return { excluded: false, target, packages: [], reason: null };
  }

  const req = createRequire(resolve(repoRoot, "package.json"));
  const blockers = [];

  for (const fam of NATIVE_FAMILIES) {
    const pkg = fam.pkg(target);
    // Match `"parent>pkg": "-"` (or '-') with flexible quoting/spacing, exactly as
    // the committed file writes it.
    const key = `${fam.parent}>${pkg}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const excludedInConfig = new RegExp(`["']?${key}["']?\\s*:\\s*["']-["']`).test(workspace);
    if (!excludedInConfig) continue;

    // Config says it is stripped — but did someone supply it anyway? If it
    // resolves, the build can run and there is nothing to excuse.
    let present = false;
    try {
      req.resolve(pkg);
      present = true;
    } catch {
      present = false;
    }
    if (!present) blockers.push(pkg);
  }

  if (blockers.length === 0) return { excluded: false, target, packages: [], reason: null };

  return {
    excluded: true,
    target,
    packages: blockers,
    reason:
      `pnpm-workspace.yaml strips ${blockers.length} native binar${blockers.length === 1 ? "y" : "ies"} ` +
      `for ${target} (${blockers.join(", ")}), and ${blockers.length === 1 ? "it is" : "they are"} not installed. ` +
      `The repo pins the web build to linux-x64 on purpose, so this step cannot run here — ` +
      `it is not failing, it is absent. Install the binaries to run it for real.`,
  };
}
