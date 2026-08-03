// Docker ↔ lifecycle-hook drift guard.
//
// WHY THIS EXISTS — a real cross-lane break, not a theory. A `prepare` hook
// (`node scripts/install-git-hooks.mjs`) was added to the root `package.json`. Every
// local gate stayed green, because every local gate reads source. The prod-compose
// smoke then died inside `docker build` with:
//
//     . prepare$ node scripts/install-git-hooks.mjs
//     Error: Cannot find module '/app/scripts/install-git-hooks.mjs'
//
// `Dockerfile.api` deliberately copies a MINIMAL slice of `scripts/` — the workspace
// manifest plus the one hook entrypoint it knew about — to keep the build context
// small. Adding a second hook without adding its file to that list breaks the image.
//
// THE PART WORTH REMEMBERING. `install-git-hooks.mjs` is written to be non-fatal in
// every branch: it exits 0 on CI, on a missing `.git`, on a missing hook file. Its
// header even says so. None of that care survives the file being ABSENT, because
// `node <missing file>` fails before the first line of it runs. **A script's own
// defensive handling cannot cover the case where the script is not there.** The same
// shape as every other finding in this repo: the guarantee lives inside the thing
// being guarded, so it cannot speak to the thing's own absence.
//
// WHY A DERIVED CHECK RATHER THAN A LIST. The obvious fix is "remember to update the
// Dockerfile", which is the instance, not the class — the next hook breaks it again.
// This derives the requirement from `package.json` itself, so a hook added tomorrow
// is covered without anyone editing this file.
//
// WHY IT BELONGS IN PREFLIGHT SPECIFICALLY. The Docker-compose smoke is one of the
// three CI jobs `preflight.mjs` documents that it does NOT mirror. That is a
// deliberate trade (Docker is slow and not always available), and it leaves this
// entire class invisible locally by construction. This check needs no Docker: it
// reads two text files in milliseconds and fails on exactly the mismatch the build
// would have found half an hour later.
//
//   node scripts/check-docker-lifecycle-copy.mjs

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** npm/pnpm lifecycle hooks that run during `pnpm install` at the ROOT project.
 *  Only these matter: a hook on a workspace package runs with that package's own
 *  files, which the Dockerfiles copy wholesale or not at all. */
const INSTALL_LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepublish"];

/** Repo-relative script paths referenced by a lifecycle command.
 *
 *  Matches `node <path>` / `node --flag <path>` and bare `<path>` tokens ending in a
 *  JS extension. Deliberately conservative: a hook that shells out to something this
 *  cannot see is reported as UNPARSED rather than silently treated as satisfied,
 *  because "I found no files to require" and "this hook needs no files" are different
 *  claims and only one of them is safe to assume. */
function referencedPaths(command) {
  const paths = [...command.matchAll(/(?:^|\s)((?:\.\/)?[\w./-]+\.(?:mjs|cjs|js))(?=\s|$)/g)].map((m) =>
    m[1].replace(/^\.\//, ""),
  );
  return [...new Set(paths)];
}

function main() {
  console.log("Docker ↔ lifecycle-hook drift guard\n");

  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};

  /** [{hook, command, files}] */
  const hooks = [];
  for (const hook of INSTALL_LIFECYCLE) {
    const command = scripts[hook];
    if (typeof command !== "string" || command.trim() === "") continue;
    hooks.push({ hook, command, files: referencedPaths(command) });
  }

  if (hooks.length === 0) {
    console.log("  no root install-lifecycle hooks declared — nothing a Docker build must carry.");
    console.log("Docker lifecycle-copy check passed.");
    return;
  }

  for (const h of hooks) {
    console.log(`  ${h.hook}: ${h.command}`);
    console.log(`    needs: ${h.files.length > 0 ? h.files.join(", ") : "(no file path parsed)"}`);
  }

  const dockerfiles = readdirSync(repoRoot).filter((f) => f.startsWith("Dockerfile"));
  const failures = [];
  let checked = 0;

  for (const file of dockerfiles) {
    const stages = parseStages(readFileSync(join(repoRoot, file), "utf8"));
    const installing = stages.filter((s) => s.runsInstall);
    if (installing.length === 0) {
      console.log(`\n  ${file} — runs no pnpm install; hooks never execute here.`);
      continue;
    }
    for (const stage of installing) {
      console.log(`\n  ${file} [${stage.name}] — runs pnpm install; must carry every hook entrypoint.`);
      for (const h of hooks) {
        if (h.files.length === 0) {
          failures.push(
            `${file} [${stage.name}]: root "${h.hook}" is \`${h.command}\` and no file path could be parsed ` +
              `from it — this guard cannot confirm the image carries what the hook needs. Make the hook's ` +
              `entrypoint an explicit .mjs/.cjs/.js path, or the Docker build is unguarded.`,
          );
          continue;
        }
        for (const needed of h.files) {
          checked += 1;
          if (stage.copiedPaths.some((p) => satisfies(p, needed))) {
            console.log(`    ok — ${needed} (${h.hook})`);
            continue;
          }
          failures.push(
            `${file} [${stage.name}] runs \`pnpm install\` but never COPYs ${needed}, which the root ` +
              `"${h.hook}" hook executes. The build will fail with "Cannot find module /app/${needed}".`,
          );
        }
      }
    }
  }

  console.log(`\nhook×dockerfile pairs checked: ${checked}`);

  if (failures.length > 0) {
    console.error(`\nDocker lifecycle-copy check FAILED: ${failures.length} problem${failures.length === 1 ? "" : "s"}.\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(
      "\nAdd the missing path to that Dockerfile's COPY of ./scripts/ (or copy the directory).\n" +
        "A hook that is defensively written still cannot survive its own file being absent.\n",
    );
    process.exit(1);
  }

  console.log("Docker lifecycle-copy check passed — every root install hook's entrypoint reaches every image that installs.");
}

/**
 * Split a Dockerfile into build stages, recording each stage's COPY SOURCES and
 * whether it runs an install.
 *
 * BOTH of these precisions were forced by a negative control that did NOT fire.
 * The first version asked `dockerfileText.includes(neededPath)` and passed with the
 * fix deliberately reverted, for two independent reasons:
 *
 *  1. IT MATCHED PROSE. The Dockerfile's own explanatory comment names
 *     `scripts/install-git-hooks.mjs`, so a Dockerfile that merely *mentions* the
 *     file satisfied a check meant to prove it is COPIED. Same defect the core
 *     generator's NC-5 control exists for ("the tripwire matches a real call and is
 *     not fooled by prose"), reproduced here by hand.
 *  2. IT IGNORED STAGES. The build that broke was the BUILDER stage; a `COPY --from`
 *     in the runtime stage cannot help it, and a whole-file search cannot tell the
 *     two apart.
 *
 * So: only real COPY instructions, and per-stage. Line continuations are joined
 * first, because a multi-line COPY is one instruction.
 */
function parseStages(text) {
  const joined = text.replace(/\\\r?\n\s*/g, " ");
  const stages = [];
  let current = null;
  for (const rawLine of joined.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#") || line === "") continue;
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      current = { name: from[1] ?? `stage${stages.length}`, copiedPaths: [], runsInstall: false };
      stages.push(current);
      continue;
    }
    if (current === null) continue;
    if (/^RUN\s+.*\bpnpm\s+install\b/i.test(line)) current.runsInstall = true;
    const copy = /^COPY\s+(.*)$/i.exec(line);
    if (copy) {
      // Drop flags (--from=, --chown=) and the final destination argument.
      const args = copy[1].split(/\s+/).filter((a) => a !== "" && !a.startsWith("--"));
      current.copiedPaths.push(...args.slice(0, -1));
    }
  }
  return stages;
}

/** Does a COPY source bring `needed` into the image? Either it names the file (with
 *  or without a `/app/` prefix from a `--from` stage) or it copies a directory that
 *  contains it. */
function satisfies(copySource, needed) {
  const src = copySource.replace(/^\/app\//, "").replace(/^\.\//, "");
  if (src === needed) return true;
  if (src.endsWith("/") && needed.startsWith(src)) return true;
  return false;
}

main();
