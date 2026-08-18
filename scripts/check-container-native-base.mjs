// A Dockerfile that cannot build is not a deployment path — it is a document.
//
//   node scripts/check-container-native-base.mjs
//
// WHY THIS EXISTS
//
// `pnpm-workspace.yaml` deliberately strips every native platform binary except
// **linux-x64-gnu** (rollup, lightningcss, @tailwindcss/oxide) plus the single
// libc-agnostic `@esbuild/linux-x64`. That decision is good — it keeps the
// install small and the supply-chain surface narrow — and `scripts/lib/
// platform-native-build.mjs` already teaches the HOST toolchain to be honest
// about it (a build that structurally cannot run here is "unavailable", not
// "passed").
//
// Containers were the blind spot. A Dockerfile picks its own platform triple,
// and both of ours picked one the workspace forbids:
//
//   · `node:22-alpine` is **musl**, and `rollup>@rollup/rollup-linux-x64-musl`,
//     `lightningcss-linux-x64-musl` and `@tailwindcss/oxide-linux-x64-musl` are
//     all stripped. The web bundle could never build in that base.
//   · Neither builder stage pinned `--platform`, so the triple was whatever the
//     host happened to be. On the CI runner that is linux/amd64 and the API
//     image built fine; on an Apple Silicon Mac it is linux/arm64, where
//     `@esbuild/linux-arm64` is stripped — so the same Dockerfile failed.
//
// Nobody noticed because `docker-compose.prod.yml` (the file CI's deploy-stack
// job builds) contains only `db` and `api`. The web image is referenced solely
// by the dev `docker-compose.yml`, which no gate ever built. An unbuildable
// artifact sat in the repo looking like a shipped one.
//
// WHAT THIS ENFORCES
//
//   1. Every build stage that runs a JS bundler MUST pin `--platform`. An
//      unpinned base means the triple is the host's, which makes "does it
//      build?" a property of whose laptop you are on. That is the exact
//      ambiguity that hid this.
//   2. The resulting triple must be one for which the workspace ships a COMPLETE
//      native set. Derived by READING pnpm-workspace.yaml at run time — the same
//      single authority platform-native-build.mjs uses. You cannot exempt a base
//      image by editing a list here; widen the workspace overrides (and the
//      lockfile) or change the base.
//
// Rule 2 is deliberately whole-set rather than per-stage. Today the API builder
// happens to reach for esbuild only, and esbuild's linux-x64 binary does run on
// musl — so alpine works there by luck of which bundler that package chose. That
// is not a property a Dockerfile can hold across the next dependency change, and
// the failure it produces is a red CI job, not a warning. One supported triple
// for every build stage is the cheaper invariant.
//
// Runtime-only stages are not checked: they copy an already-built bundle and
// may stay native-arch, which is faster and correct.
//
// WHAT THIS DOES NOT PROVE — and the way it was learned. A green here means the
// base image targets a triple whose native binaries exist. It does NOT mean the
// image builds. It cannot: the build context is assembled BY the Dockerfile, so a
// file that is never COPY'd simply is not there, and no amount of reading this
// file will reveal it. Immediately after this gate first went green, a real build
// on the owner's Mac found Dockerfile.web still broken twice over — neither
// `tsconfig.base.json` (both app tsconfigs `extends` it) nor
// `scripts/enforce-pnpm.cjs` (the root `preinstall` hook runs it) was copied in.
//
// So `review-hub-ci.yml`'s deploy-stack job now runs `docker build -f
// Dockerfile.web` for real. This gate is the cheap check that runs everywhere in a
// second; that build is the one that actually answers the question. Keep both —
// but do not let a green here be read as the stronger claim.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(resolve(repo, f), "utf8");

// The native families the workspace strips, and how each one names its binary
// for a given triple. esbuild is deliberately libc-agnostic — it ships one
// statically linked `@esbuild/<platform>-<arch>` that runs on musl and glibc
// alike, which is why the strip list has no musl entries for it.
const FAMILIES = [
  { parent: "rollup", name: (os, arch, libc) => (os === "linux" ? `@rollup/rollup-linux-${arch}-${libc}` : `@rollup/rollup-${os}-${arch}`) },
  // Vite 8 executes Rolldown, not Rollup — same platform-binding shape, msvc-suffixed on win32.
  { parent: "rolldown", name: (os, arch, libc) => (os === "linux" ? `@rolldown/binding-linux-${arch}-${libc}` : os === "win32" ? `@rolldown/binding-win32-${arch}-msvc` : `@rolldown/binding-${os}-${arch}`) },
  { parent: "esbuild", name: (os, arch) => `@esbuild/${os}-${arch}` },
  { parent: "lightningcss", name: (os, arch, libc) => (os === "linux" ? `lightningcss-linux-${arch}-${libc}` : `lightningcss-${os}-${arch}`) },
  { parent: "@tailwindcss/oxide", name: (os, arch, libc) => (os === "linux" ? `@tailwindcss/oxide-linux-${arch}-${libc}` : `@tailwindcss/oxide-${os}-${arch}`) },
];

// Base-image name → libc. Anything alpine-derived is musl; the Debian-derived
// node tags (bookworm/trixie, `-slim`, and the bare `node:N`) are glibc.
const libcOf = (image) => (/alpine/i.test(image) ? "musl" : "gnu");

// A stage "builds" if it runs a package-manager build script. That is what pulls
// rollup/esbuild/lightningcss/oxide off disk; an install alone only skips the
// missing optional dependency and stays silent.
const BUILD_RUN = /^\s*RUN\b[^\n]*\b(?:pnpm|npm|yarn)\b[^\n]*\brun\s+build\b|^\s*RUN\b[^\n]*\b(?:pnpm|npm|yarn)\s+build\b/;

/** Parse `FROM [--platform=P] image [AS name]` plus each stage's RUN lines. */
function stagesOf(body) {
  const out = [];
  let cur = null;
  for (const [i, raw] of body.split("\n").entries()) {
    const from = raw.match(/^\s*FROM\s+(?:--platform=(\S+)\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      cur = { platform: from[1] ?? null, image: from[2], as: from[3] ?? null, line: i + 1, builds: false };
      out.push(cur);
      continue;
    }
    if (cur && BUILD_RUN.test(raw)) cur.builds = true;
  }
  return out;
}

const workspace = read("pnpm-workspace.yaml");
const isStripped = (parent, pkg) => {
  const key = `${parent}>${pkg}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["']?${key}["']?\\s*:\\s*["']-["']`).test(workspace);
};

// Which linux triples does the workspace ship a COMPLETE native set for? Derived,
// so widening the overrides widens what bases are legal, with no edit here.
const CANDIDATES = ["x64-gnu", "x64-musl", "arm64-gnu", "arm64-musl"];
const supported = CANDIDATES.filter((t) => {
  const [arch, libc] = t.split("-");
  return FAMILIES.every((f) => !isStripped(f.parent, f.name("linux", arch, libc)));
});

const dockerfiles = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter((f) => /(^|\/)Dockerfile(\.|$)/.test(f));

const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

let checked = 0;
for (const file of dockerfiles) {
  for (const st of stagesOf(read(file))) {
    if (!st.builds) continue;
    checked += 1;
    const label = `${file}:${st.line} (${st.as ?? "unnamed stage"}, ${st.image})`;

    if (!st.platform) {
      bad(`${label} runs a bundler build with no --platform pin — the triple would be the build host's. ` +
          `The workspace ships a complete native set for linux ${supported.join(", ") || "(none)"} only; ` +
          `pin it so the image builds the same everywhere.`);
      continue;
    }

    const m = st.platform.match(/^([a-z0-9]+)\/([a-z0-9]+)/i);
    if (!m) { bad(`${label} has an unparseable --platform=${st.platform}`); continue; }
    const os = m[1].toLowerCase();
    // Docker's platform vocabulary is not npm's: amd64→x64, 386→ia32.
    const arch = ({ amd64: "x64", 386: "ia32" })[m[2].toLowerCase()] ?? m[2].toLowerCase();
    const libc = libcOf(st.image);

    const missing = FAMILIES
      .map((f) => ({ parent: f.parent, pkg: f.name(os, arch, libc) }))
      .filter((c) => isStripped(c.parent, c.pkg));

    if (missing.length) {
      bad(`${label} targets ${os}-${arch}-${libc}, for which pnpm-workspace.yaml strips ` +
          `${missing.map((b) => b.pkg).join(", ")}. The workspace ships a complete native set only for ` +
          `linux ${supported.join(", ") || "(none)"} — target that (e.g. --platform=linux/amd64 on a glibc base), ` +
          `or widen the overrides and regenerate the lockfile.`);
    } else {
      ok(`${label} → ${os}-${arch}-${libc}: the workspace ships every native binary this triple needs`);
    }
  }
}

// ── Every base image must name its registry ──────────────────────────────────
//
// `node:22-bookworm-slim` is not a name, it is a LOOKUP against whatever search
// list the engine happens to be configured with. Docker silently implies
// docker.io; podman resolves it through a shortnames alias file shipped by the
// host. A real run on a Mac printed the tell:
//
//   Resolved "node" as an alias (/usr/share/containers/registries.conf.d/000-shortnames.conf)
//
// The machine, not this repository, decided where the base image came from. That
// is a supply-chain decision living in host config, and it is the same rule
// docker-verify.mjs already applies to the postgres/redis images it runs — this
// file simply did not enforce it on the images it reads, so three FROMs drifted.
// Fully qualified works identically on both engines.
const FROM_LINE = /^FROM\s+(?:--\S+\s+)*(\S+)/;
for (const file of dockerfiles) {
  const text = read(file);
  text.split("\n").forEach((line, i) => {
    const m = FROM_LINE.exec(line);
    if (!m) return;
    const image = m[1];
    // A registry host has a dot (docker.io, ghcr.io, gcr.io) or is localhost.
    const host = image.split("/")[0];
    const qualified = host === "localhost" || /\./.test(host);
    // `FROM builder` — a reference to an earlier named stage — is not an image.
    const isStageRef = !image.includes("/") && !image.includes(":");
    if (qualified || isStageRef) return;
    bad(
      `${file}:${i + 1} — base image "${image}" has no registry. Which registry it ` +
        `resolves to is then decided by host config (docker implies docker.io; podman ` +
        `uses a shortnames alias file). Write it out: docker.io/library/${image}`,
    );
  });
}

if (checked === 0) {
  // Zero build stages found means the parser stopped matching reality, not that
  // the repo stopped shipping images. A guard that silently checks nothing is
  // worse than no guard.
  bad("No bundler build stage found in any Dockerfile — the detector is stale, not the repo clean.");
}

console.log("");
if (failures.length) {
  console.error(`Container native-base check FAILED (${failures.length} issue${failures.length > 1 ? "s" : ""}).`);
  process.exit(1);
}
console.log(
  `Container native-base check passed — ${checked} build stage${checked === 1 ? "" : "s"} target a supported triple.\n` +
    "  NOT established: that these images BUILD. A missing COPY is invisible to a static\n" +
    "  read of the Dockerfile, and exactly that shipped past an earlier green here. The\n" +
    "  deploy-stack job builds them for real; this is the cheap check, not the answer.",
);
